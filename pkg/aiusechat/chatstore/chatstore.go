// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"container/list"
	"fmt"
	"slices"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const DefaultMaxChats = 20

type chatEntry struct {
	chatId string
	chat   *uctypes.AIChat
}

type ChatStore struct {
	lock     sync.Mutex
	chats    map[string]*list.Element
	lruList  *list.List
	maxChats int
}

var DefaultChatStore = &ChatStore{
	chats:    make(map[string]*list.Element),
	lruList:  list.New(),
	maxChats: DefaultMaxChats,
}

func (cs *ChatStore) ensureInitLocked() {
	if cs.chats == nil {
		cs.chats = make(map[string]*list.Element)
	}
	if cs.lruList == nil {
		cs.lruList = list.New()
	}
	if cs.maxChats <= 0 {
		cs.maxChats = DefaultMaxChats
	}
}

func (cs *ChatStore) evictIfNeededLocked() {
	for cs.lruList.Len() > cs.maxChats {
		oldest := cs.lruList.Back()
		if oldest == nil {
			break
		}
		entry := oldest.Value.(*chatEntry)
		delete(cs.chats, entry.chatId)
		cs.lruList.Remove(oldest)
	}
}

func (cs *ChatStore) Get(chatId string) *uctypes.AIChat {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	cs.ensureInitLocked()

	elem := cs.chats[chatId]
	if elem == nil {
		return nil
	}
	cs.lruList.MoveToFront(elem)
	chat := elem.Value.(*chatEntry).chat

	// Copy the chat to prevent concurrent access issues
	copyChat := &uctypes.AIChat{
		ChatId:         chat.ChatId,
		APIType:        chat.APIType,
		Model:          chat.Model,
		APIVersion:     chat.APIVersion,
		NativeMessages: make([]uctypes.GenAIMessage, len(chat.NativeMessages)),
	}
	copy(copyChat.NativeMessages, chat.NativeMessages)

	return copyChat
}

func (cs *ChatStore) Delete(chatId string) {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	cs.ensureInitLocked()

	if elem := cs.chats[chatId]; elem != nil {
		cs.lruList.Remove(elem)
		delete(cs.chats, chatId)
	}
}

func (cs *ChatStore) CountUserMessages(chatId string) int {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	cs.ensureInitLocked()

	elem := cs.chats[chatId]
	if elem == nil {
		return 0
	}
	chat := elem.Value.(*chatEntry).chat

	count := 0
	for _, msg := range chat.NativeMessages {
		if msg.GetRole() == "user" {
			count++
		}
	}
	return count
}

func (cs *ChatStore) PostMessage(chatId string, aiOpts *uctypes.AIOptsType, message uctypes.GenAIMessage) error {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	cs.ensureInitLocked()

	elem := cs.chats[chatId]
	var chat *uctypes.AIChat
	if elem == nil {
		// Create new chat
		chat = &uctypes.AIChat{
			ChatId:         chatId,
			APIType:        aiOpts.APIType,
			Model:          aiOpts.Model,
			APIVersion:     aiOpts.APIVersion,
			NativeMessages: make([]uctypes.GenAIMessage, 0),
		}
		elem = cs.lruList.PushFront(&chatEntry{chatId: chatId, chat: chat})
		cs.chats[chatId] = elem
		cs.evictIfNeededLocked()
	} else {
		chat = elem.Value.(*chatEntry).chat
		// Verify that the AI options match
		if chat.APIType != aiOpts.APIType {
			return fmt.Errorf("API type mismatch: expected %s, got %s (must start a new chat)", chat.APIType, aiOpts.APIType)
		}
		if !uctypes.AreModelsCompatible(chat.APIType, chat.Model, aiOpts.Model) {
			return fmt.Errorf("model mismatch: expected %s, got %s (must start a new chat)", chat.Model, aiOpts.Model)
		}
		if chat.APIVersion != aiOpts.APIVersion {
			return fmt.Errorf("API version mismatch: expected %s, got %s (must start a new chat)", chat.APIVersion, aiOpts.APIVersion)
		}
		cs.lruList.MoveToFront(elem)
	}

	// Check for existing message with same ID (idempotency)
	messageId := message.GetMessageId()
	for i, existingMessage := range chat.NativeMessages {
		if existingMessage.GetMessageId() == messageId {
			// Replace existing message with same ID
			chat.NativeMessages[i] = message
			return nil
		}
	}

	// Append the new message if no duplicate found
	chat.NativeMessages = append(chat.NativeMessages, message)

	return nil
}

func (cs *ChatStore) RemoveMessage(chatId string, messageId string) bool {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	cs.ensureInitLocked()

	elem := cs.chats[chatId]
	if elem == nil {
		return false
	}
	cs.lruList.MoveToFront(elem)
	chat := elem.Value.(*chatEntry).chat

	initialLen := len(chat.NativeMessages)
	chat.NativeMessages = slices.DeleteFunc(chat.NativeMessages, func(msg uctypes.GenAIMessage) bool {
		return msg.GetMessageId() == messageId
	})

	return len(chat.NativeMessages) < initialLen
}
