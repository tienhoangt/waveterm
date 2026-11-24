// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

// the blockstore package implements a write cache for wave files
// it is not a read cache (reads still go to the DB -- unless items are in the cache)
// but all writes only go to the cache, and then the cache is periodically flushed to the DB

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/ijson"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// ijson meta keys
	IJsonNumCommands      = "ijson:numcmds"
	IJsonIncrementalBytes = "ijson:incbytes"
)

const (
	IJsonHighCommands = 100
	IJsonHighRatio    = 3
	IJsonLowRatio     = 1
	IJsonLowCommands  = 10
)

const DefaultPartDataSize = 64 * 1024
const DefaultFlushTime = 15 * time.Second
const DefaultIdleEvictTime = 60 * time.Second
const NoPartIdx = -1

var ErrFlushInProgress = fmt.Errorf("flush already in progress")

// for unit tests
var warningCount = &atomic.Int32{}
var flushErrorCount = &atomic.Int32{}

var partDataSize int64 = DefaultPartDataSize // overridden in tests
var stopFlush = &atomic.Bool{}

var WFS *FileStore = &FileStore{
	Lock:  &sync.Mutex{},
	Cache: make(map[cacheKey]*CacheEntry),
}

type WaveFile struct {
	// these fields are static (not updated)
	ZoneId    string          `json:"zoneid"`
	Name      string          `json:"name"`
	Opts      wshrpc.FileOpts `json:"opts"`
	CreatedTs int64           `json:"createdts"`

	//  these fields are mutable
	Size  int64           `json:"size"`
	ModTs int64           `json:"modts"`
	Meta  wshrpc.FileMeta `json:"meta"` // only top-level keys can be updated (lower levels are immutable)
}

// for regular files this is just Size
// for circular files this is min(Size, MaxSize)
func (f WaveFile) DataLength() int64 {
	if f.Opts.Circular {
		return minInt64(f.Size, f.Opts.MaxSize)
	}
	return f.Size
}

// for regular files this is just 0
// for circular files this is the index of the first byte of data we have
func (f WaveFile) DataStartIdx() int64 {
	if f.Opts.Circular && f.Size > f.Opts.MaxSize {
		return f.Size - f.Opts.MaxSize
	}
	return 0
}

// this works because lower levels are immutable
func copyMeta(meta wshrpc.FileMeta) wshrpc.FileMeta {
	newMeta := make(wshrpc.FileMeta)
	for k, v := range meta {
		newMeta[k] = v
	}
	return newMeta
}

func (f *WaveFile) DeepCopy() *WaveFile {
	if f == nil {
		return nil
	}
	newFile := *f
	newFile.Meta = copyMeta(f.Meta)
	return &newFile
}

func (WaveFile) UseDBMap() {}

type FileData struct {
	ZoneId  string `json:"zoneid"`
	Name    string `json:"name"`
	PartIdx int    `json:"partidx"`
	Data    []byte `json:"data"`
}

func (FileData) UseDBMap() {}

// synchronous (does not interact with the cache)
func (s *FileStore) MakeFile(ctx context.Context, zoneId string, name string, meta wshrpc.FileMeta, opts wshrpc.FileOpts) error {
	if opts.MaxSize < 0 {
		return fmt.Errorf("max size must be non-negative")
	}
	if opts.Circular && opts.MaxSize <= 0 {
		return fmt.Errorf("circular file must have a max size")
	}
	if opts.Circular && opts.IJson {
		return fmt.Errorf("circular file cannot be ijson")
	}
	if opts.Circular {
		if opts.MaxSize%partDataSize != 0 {
			opts.MaxSize = (opts.MaxSize/partDataSize + 1) * partDataSize
		}
	}
	if opts.IJsonBudget > 0 && !opts.IJson {
		return fmt.Errorf("ijson budget requires ijson")
	}
	if opts.IJsonBudget < 0 {
		return fmt.Errorf("ijson budget must be non-negative")
	}
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		if entry.File != nil {
			return fs.ErrExist
		}
		now := time.Now().UnixMilli()
		file := &WaveFile{
			ZoneId:    zoneId,
			Name:      name,
			Size:      0,
			CreatedTs: now,
			ModTs:     now,
			Opts:      opts,
			Meta:      meta,
		}
		return dbInsertFile(ctx, file)
	})
}

func (s *FileStore) DeleteFile(ctx context.Context, zoneId string, name string) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := dbDeleteFile(ctx, zoneId, name)
		if err != nil {
			return fmt.Errorf("error deleting file: %v", err)
		}
		entry.clear()
		return nil
	})
}

func (s *FileStore) DeleteZone(ctx context.Context, zoneId string) error {
	fileNames, err := dbGetZoneFileNames(ctx, zoneId)
	if err != nil {
		return fmt.Errorf("error getting zone files: %v", err)
	}
	for _, name := range fileNames {
		s.DeleteFile(ctx, zoneId, name)
	}
	return nil
}

// if file doesn't exsit, returns fs.ErrNotExist
func (s *FileStore) Stat(ctx context.Context, zoneId string, name string) (*WaveFile, error) {
	return withLockRtn(s, zoneId, name, func(entry *CacheEntry) (*WaveFile, error) {
		file, err := entry.loadFileForRead(ctx)
		if err != nil {
			if err == fs.ErrNotExist {
				return nil, err
			}
			return nil, fmt.Errorf("error getting file: %v", err)
		}
		return file.DeepCopy(), nil
	})
}

func (s *FileStore) ListFiles(ctx context.Context, zoneId string) ([]*WaveFile, error) {
	files, err := dbGetZoneFiles(ctx, zoneId)
	if err != nil {
		return nil, fmt.Errorf("error getting zone files: %v", err)
	}
	for idx, file := range files {
		withLock(s, file.ZoneId, file.Name, func(entry *CacheEntry) error {
			if entry.File != nil {
				files[idx] = entry.File.DeepCopy()
			}
			return nil
		})
	}
	return files, nil
}

func (s *FileStore) WriteMeta(ctx context.Context, zoneId string, name string, meta wshrpc.FileMeta, merge bool) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		if merge {
			for k, v := range meta {
				if v == nil {
					delete(entry.File.Meta, k)
					continue
				}
				entry.File.Meta[k] = v
			}
		} else {
			entry.File.Meta = meta
		}
		entry.File.ModTs = time.Now().UnixMilli()
		entry.DirtyGen++
		entry.LastAccessTs = time.Now()
		return nil
	})
}

func (s *FileStore) WriteFile(ctx context.Context, zoneId string, name string, data []byte) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		entry.writeAt(0, data, true)
		// since WriteFile can *truncate* the file, we need to flush the file to the DB immediately
		return entry.flushToDB(ctx, true)
	})
}

func (s *FileStore) WriteAt(ctx context.Context, zoneId string, name string, offset int64, data []byte) error {
	if offset < 0 {
		return fmt.Errorf("offset must be non-negative")
	}
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		file := entry.File
		if offset > file.Size {
			return fmt.Errorf("offset is past the end of the file")
		}
		partMap := file.computePartMap(offset, int64(len(data)))
		incompleteParts := incompletePartsFromMap(partMap)
		err = entry.loadDataPartsIntoCache(ctx, incompleteParts)
		if err != nil {
			return err
		}
		entry.writeAt(offset, data, false)
		return nil
	})
}

func (s *FileStore) AppendData(ctx context.Context, zoneId string, name string, data []byte) error {
	_, err := s.AppendDataWithOffset(ctx, zoneId, name, data)
	return err
}

func (s *FileStore) AppendDataWithOffset(ctx context.Context, zoneId string, name string, data []byte) (int64, error) {
	return withLockRtn(s, zoneId, name, func(entry *CacheEntry) (int64, error) {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return 0, err
		}
		partMap := entry.File.computePartMap(entry.File.Size, int64(len(data)))
		incompleteParts := incompletePartsFromMap(partMap)
		if len(incompleteParts) > 0 {
			err = entry.loadDataPartsIntoCache(ctx, incompleteParts)
			if err != nil {
				return 0, err
			}
		}
		entry.writeAt(entry.File.Size, data, false)
		return entry.File.Size, nil
	})
}

func metaIncrement(file *WaveFile, key string, amount int) int {
	if file.Meta == nil {
		file.Meta = make(wshrpc.FileMeta)
	}
	val, ok := file.Meta[key].(int)
	if !ok {
		val = 0
	}
	newVal := val + amount
	file.Meta[key] = newVal
	return newVal
}

func (s *FileStore) compactIJson(ctx context.Context, entry *CacheEntry) error {
	// we don't need to lock the entry because we have the lock on the filestore
	_, fullData, err := entry.readAt(ctx, 0, 0, true)
	if err != nil {
		return err
	}
	newBytes, err := ijson.CompactIJson(fullData, entry.File.Opts.IJsonBudget)
	if err != nil {
		return err
	}
	entry.writeAt(0, newBytes, true)
	return nil
}

func (s *FileStore) CompactIJson(ctx context.Context, zoneId string, name string) error {
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		if !entry.File.Opts.IJson {
			return fmt.Errorf("file %s:%s is not an ijson file", zoneId, name)
		}
		return s.compactIJson(ctx, entry)
	})
}

func (s *FileStore) AppendIJson(ctx context.Context, zoneId string, name string, command map[string]any) error {
	data, err := ijson.ValidateAndMarshalCommand(command)
	if err != nil {
		return err
	}
	return withLock(s, zoneId, name, func(entry *CacheEntry) error {
		err := entry.loadFileIntoCache(ctx)
		if err != nil {
			return err
		}
		if !entry.File.Opts.IJson {
			return fmt.Errorf("file %s:%s is not an ijson file", zoneId, name)
		}
		partMap := entry.File.computePartMap(entry.File.Size, int64(len(data)))
		incompleteParts := incompletePartsFromMap(partMap)
		if len(incompleteParts) > 0 {
			err = entry.loadDataPartsIntoCache(ctx, incompleteParts)
			if err != nil {
				return err
			}
		}
		oldSize := entry.File.Size
		entry.writeAt(entry.File.Size, data, false)
		entry.writeAt(entry.File.Size, []byte("\n"), false)
		if oldSize == 0 {
			return nil
		}
		// check if we should compact
		numCmds := metaIncrement(entry.File, IJsonNumCommands, 1)
		numBytes := metaIncrement(entry.File, IJsonIncrementalBytes, len(data)+1)
		incRatio := float64(numBytes) / float64(entry.File.Size)
		if numCmds > IJsonHighCommands || incRatio >= IJsonHighRatio || (numCmds > IJsonLowCommands && incRatio >= IJsonLowRatio) {
			err := s.compactIJson(ctx, entry)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileStore) GetAllZoneIds(ctx context.Context) ([]string, error) {
	return dbGetAllZoneIds(ctx)
}

// returns (offset, data, error)
// we return the offset because the offset may have been adjusted if the size was too big (for circular files)
func (s *FileStore) ReadAt(ctx context.Context, zoneId string, name string, offset int64, size int64) (rtnOffset int64, rtnData []byte, rtnErr error) {
	if size < 0 || size > math.MaxInt {
		return 0, nil, fmt.Errorf("size must be non-negative and less than MaxInt")
	}
	withLock(s, zoneId, name, func(entry *CacheEntry) error {
		rtnOffset, rtnData, rtnErr = entry.readAt(ctx, offset, size, false)
		return nil
	})
	return
}

// returns (offset, data, error)
func (s *FileStore) ReadFile(ctx context.Context, zoneId string, name string) (rtnOffset int64, rtnData []byte, rtnErr error) {
	withLock(s, zoneId, name, func(entry *CacheEntry) error {
		rtnOffset, rtnData, rtnErr = entry.readAt(ctx, 0, 0, true)
		return nil
	})
	return
}

type FlushStats struct {
	FlushDuration   time.Duration
	NumDirtyEntries int
	NumCommitted    int
}

func (s *FileStore) FlushCache(ctx context.Context) (stats FlushStats, rtnErr error) {
	wasFlushing := s.setUnlessFlushing()
	if wasFlushing {
		return stats, ErrFlushInProgress
	}
	defer s.setIsFlushing(false)
	startTime := time.Now()
	defer func() {
		stats.FlushDuration = time.Since(startTime)
	}()

	// Phase 1: Snapshot dirty entries under each entry.Lock and release entry.Lock BEFORE opening the batch WithTx
	allKeys := s.getAllCacheKeys()
	var snaps []*cacheSnapshot
	for _, key := range allKeys {
		_ = withLock(s, key.ZoneId, key.Name, func(entry *CacheEntry) error {
			if snap := entry.snapshotDirty(); snap != nil {
				snaps = append(snaps, snap)
			}
			return nil
		})
	}
	stats.NumDirtyEntries = len(snaps)

	// Phase 2: Commit all dirty snapshots in a single SQLite transaction (no entry locks held)
	if len(snaps) > 0 {
		deletedKeys, err := dbWriteCacheBatch(ctx, snaps)
		if ctx.Err() != nil {
			return stats, ctx.Err()
		}
		if err != nil {
			flushErrorCount.Add(1)
			for _, snap := range snaps {
				_ = withLock(s, snap.Key.ZoneId, snap.Key.Name, func(entry *CacheEntry) error {
					entry.FlushErrors++
					if entry.FlushErrors > 3 {
						entry.clear()
					}
					return nil
				})
			}
			return stats, fmt.Errorf("error flushing cache batch (%d entries): %w", len(snaps), err)
		}

		// Phase 3: Mark flushed entries clean only where DirtyGen == snap.DirtyGen
		for _, snap := range snaps {
			_ = withLock(s, snap.Key.ZoneId, snap.Key.Name, func(entry *CacheEntry) error {
				if deletedKeys[snap.Key] {
					if entry.DirtyGen == snap.DirtyGen {
						entry.clear()
					}
					return nil
				}
				if entry.DirtyGen == snap.DirtyGen {
					entry.FlushedGen = snap.DirtyGen
					entry.DirtyParts = make(map[int]bool)
					entry.NeedsReplace = false
				}
				entry.FlushErrors = 0
				return nil
			})
		}
		stats.NumCommitted = len(snaps)
	}

	// Phase 4: Sweep idle clean entries (> DefaultIdleEvictTime)
	s.sweepIdleCleanEntries(DefaultIdleEvictTime)
	return stats, nil
}

// FlushWait waits for any in-flight flush to finish and commits remaining dirty entries.
func (s *FileStore) FlushWait(ctx context.Context) (FlushStats, error) {
	for {
		stats, err := s.FlushCache(ctx)
		if err != ErrFlushInProgress {
			return stats, err
		}
		ch := s.getFlushDoneCh()
		if ch == nil {
			continue
		}
		select {
		case <-ch:
		case <-ctx.Done():
			return stats, ctx.Err()
		}
	}
}

func (s *FileStore) sweepIdleCleanEntries(maxIdle time.Duration) {
	now := time.Now()
	allKeys := s.getAllCacheKeys()
	for _, key := range allKeys {
		_ = withLock(s, key.ZoneId, key.Name, func(entry *CacheEntry) error {
			if entry.File != nil && !entry.isDirty() && now.Sub(entry.LastAccessTs) > maxIdle {
				entry.clear()
			}
			return nil
		})
	}
}

///////////////////////////////////

func (f *WaveFile) partIdxAtOffset(offset int64) int {
	partIdx := int(offset / partDataSize)
	if f.Opts.Circular {
		maxPart := int(f.Opts.MaxSize / partDataSize)
		partIdx = partIdx % maxPart
	}
	return partIdx
}

func incompletePartsFromMap(partMap map[int]int) []int {
	var incompleteParts []int
	for partIdx, size := range partMap {
		if size != int(partDataSize) {
			incompleteParts = append(incompleteParts, partIdx)
		}
	}
	return incompleteParts
}

func getPartIdxsFromMap(partMap map[int]int) []int {
	var partIdxs []int
	for partIdx := range partMap {
		partIdxs = append(partIdxs, partIdx)
	}
	return partIdxs
}

// returns a map of partIdx to amount of data to write to that part
func (file *WaveFile) computePartMap(startOffset int64, size int64) map[int]int {
	partMap := make(map[int]int)
	endOffset := startOffset + size
	startFileOffset := startOffset - (startOffset % partDataSize)
	for testOffset := startFileOffset; testOffset < endOffset; testOffset += partDataSize {
		partIdx := file.partIdxAtOffset(testOffset)
		partStartOffset := testOffset
		partEndOffset := testOffset + partDataSize
		partWriteStartOffset := 0
		partWriteEndOffset := int(partDataSize)
		if startOffset > partStartOffset && startOffset < partEndOffset {
			partWriteStartOffset = int(startOffset - partStartOffset)
		}
		if endOffset > partStartOffset && endOffset < partEndOffset {
			partWriteEndOffset = int(endOffset - partStartOffset)
		}
		partMap[partIdx] = partWriteEndOffset - partWriteStartOffset
	}
	return partMap
}

func (s *FileStore) getAllCacheKeys() []cacheKey {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	keys := make([]cacheKey, 0, len(s.Cache))
	for key := range s.Cache {
		keys = append(keys, key)
	}
	return keys
}

func (s *FileStore) getFlushDoneCh() chan struct{} {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	return s.flushDoneCh
}

func (s *FileStore) setIsFlushing(flushing bool) {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	s.IsFlushing = flushing
	if !flushing && s.flushDoneCh != nil {
		close(s.flushDoneCh)
		s.flushDoneCh = nil
	}
}

// returns old value of IsFlushing
func (s *FileStore) setUnlessFlushing() bool {
	s.Lock.Lock()
	defer s.Lock.Unlock()
	if s.IsFlushing {
		return true
	}
	s.IsFlushing = true
	s.flushDoneCh = make(chan struct{})
	return false
}

func (s *FileStore) runFlushWithNewContext() (FlushStats, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultFlushTime)
	defer cancelFn()
	return s.FlushCache(ctx)
}

func (s *FileStore) runFlusher() {
	defer func() {
		panichandler.PanicHandler("filestore flusher", recover())
	}()
	for {
		stats, err := s.runFlushWithNewContext()
		if err != nil {
			log.Printf("filestore flush error: %d/%d entries flushed, err:%v\n", stats.NumCommitted, stats.NumDirtyEntries, err)
		}
		if stopFlush.Load() {
			log.Printf("filestore flusher stopping\n")
			return
		}
		time.Sleep(DefaultFlushTime)
	}
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
