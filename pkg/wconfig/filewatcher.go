// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const fileWatcherDebounceDelay = 150 * time.Millisecond

var instance *Watcher
var once sync.Once

type ConfigUpdateHandler func(FullConfigType)

type Watcher struct {
	initialized bool
	watcher     *fsnotify.Watcher
	mutex       sync.RWMutex
	fullConfig  FullConfigType
	handlers    []ConfigUpdateHandler
}

type WatcherUpdate struct {
	FullConfig FullConfigType `json:"fullconfig"`
}

// GetWatcher returns the singleton instance of the Watcher
func GetWatcher() *Watcher {
	once.Do(func() {
		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			log.Printf("failed to create file watcher: %v", err)
			return
		}
		configDirAbsPath := wavebase.GetWaveConfigDir()
		log.Printf("create config watcher, configdir=%q", configDirAbsPath)
		instance = &Watcher{watcher: watcher}
		err = instance.watcher.Add(configDirAbsPath)
		const failedStr = "failed to add path %s to watcher: %v"
		if err != nil {
			log.Printf(failedStr, configDirAbsPath, err)
		}

		subdirs := GetConfigSubdirs()
		for _, dir := range subdirs {
			err = instance.watcher.Add(dir)
			if err != nil && !os.IsNotExist(err) {
				log.Printf(failedStr, dir, err)
			}
		}
	})
	return instance
}

func (w *Watcher) LoadInitialConfig() FullConfigType {
	fullConfig := ReadFullConfig()
	w.mutex.Lock()
	w.fullConfig = fullConfig
	w.mutex.Unlock()
	return fullConfig
}

func (w *Watcher) Start() {
	w.mutex.Lock()
	log.Printf("starting file watcher\n")
	w.initialized = true
	fsWatcher := w.watcher
	w.mutex.Unlock()

	w.sendInitialValues()

	if fsWatcher == nil {
		return
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("filewatcher:Start", recover())
		}()
		var debounceTimer *time.Timer
		var debounceCh <-chan time.Time
		defer func() {
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
		}()
		for {
			select {
			case event, ok := <-fsWatcher.Events:
				if !ok {
					return
				}
				if !w.shouldHandleEvent(event) {
					continue
				}
				if debounceTimer == nil {
					debounceTimer = time.NewTimer(fileWatcherDebounceDelay)
					debounceCh = debounceTimer.C
				} else {
					if !debounceTimer.Stop() {
						select {
						case <-debounceTimer.C:
						default:
						}
					}
					debounceTimer.Reset(fileWatcherDebounceDelay)
				}
			case <-debounceCh:
				debounceCh = nil
				debounceTimer = nil
				w.reloadAndBroadcastConfig()
			case err, ok := <-fsWatcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()
}

// for initial values, exit on first error
func (w *Watcher) sendInitialValues() error {
	w.reloadAndBroadcastConfig()
	return nil
}

func (w *Watcher) Close() {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	if w.watcher != nil {
		w.watcher.Close()
		w.watcher = nil
		log.Println("file watcher closed")
	}
}

func (w *Watcher) broadcast(message WatcherUpdate, handlers []ConfigUpdateHandler) {
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_Config,
		Data:  message,
	})
	w.notifyHandlers(message.FullConfig, handlers)
}

func (w *Watcher) RegisterUpdateHandler(handler ConfigUpdateHandler) {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	w.handlers = append(w.handlers, handler)
}

func (w *Watcher) notifyHandlers(config FullConfigType, handlers []ConfigUpdateHandler) {
	for _, handler := range handlers {
		go func(h ConfigUpdateHandler) {
			defer func() {
				panichandler.PanicHandler("filewatcher:notifyHandlers", recover())
			}()
			h(config)
		}(handler)
	}
}

func (w *Watcher) GetFullConfig() FullConfigType {
	w.mutex.RLock()
	defer w.mutex.RUnlock()
	return w.fullConfig
}

func (w *Watcher) shouldHandleEvent(event fsnotify.Event) bool {
	fileName := filepath.ToSlash(event.Name)
	if event.Op == fsnotify.Chmod {
		return false
	}
	return isValidSubSettingsFileName(fileName)
}

var validFileRe = regexp.MustCompile(`^[a-zA-Z0-9_@.-]+\.json$`)

func isValidSubSettingsFileName(fileName string) bool {
	if filepath.Ext(fileName) != ".json" {
		return false
	}
	baseName := filepath.Base(fileName)
	return validFileRe.MatchString(baseName)
}

func (w *Watcher) reloadAndBroadcastConfig() {
	fullConfig := ReadFullConfig()
	w.mutex.Lock()
	w.fullConfig = fullConfig
	handlers := make([]ConfigUpdateHandler, len(w.handlers))
	copy(handlers, w.handlers)
	w.mutex.Unlock()
	w.broadcast(WatcherUpdate{FullConfig: fullConfig}, handlers)
}
