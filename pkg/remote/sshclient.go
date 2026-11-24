// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/skeema/knownhosts"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/trimquotes"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	xknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

const SshProxyJumpMaxDepth = 10

const (
	ConnErrCode_ConfigParse    = "config-parse"
	ConnErrCode_ConfigDefault  = "config-default"
	ConnErrCode_ProxyDepth     = "proxy-depth"
	ConnErrCode_ProxyParse     = "proxy-parse"
	ConnErrCode_SecretStore    = "secret-error"
	ConnErrCode_SecretNotFound = "secret-notfound"
	ConnErrCode_KnownHostsNone = "knownhosts-none"
	ConnErrCode_KnownHostsFmt  = "knownhosts-format"
	ConnErrCode_Dial           = "dial-error"
	ConnErrCode_ProxyJumpDial  = "dial-proxy-jump"
	ConnErrCode_HostKeyRevoked = "hostkey-revoked"
	ConnErrCode_HostKeyChanged = "hostkey-changed"
	ConnErrCode_HostKeyVerify  = "hostkey-verify"
	ConnErrCode_UserCancelled  = "user-cancelled"
	ConnErrCode_UserTimeout    = "user-timeout"
	ConnErrCode_AuthFailed     = "auth-failed"
	ConnErrCode_Unknown        = "unknown"
)

// Dial error subcodes for more granular classification
const (
	DialSubCode_DNS             = "dns"
	DialSubCode_Refused         = "refused"
	DialSubCode_Timeout         = "timeout"
	DialSubCode_ContextCanceled = "context-canceled"
	DialSubCode_NoRoute         = "no-route"
	DialSubCode_HostUnreach     = "host-unreachable"
	DialSubCode_NetUnreach      = "net-unreachable"
	DialSubCode_ConnReset       = "conn-reset"
	DialSubCode_PermDenied      = "perm-denied"
	DialSubCode_ProxyJump       = "proxy-jump"
	DialSubCode_Other           = "other"
)

// Auth error subcodes for more granular classification
const (
	AuthSubCode_UnableToAuth    = "unable-to-auth"
	AuthSubCode_HandshakeFailed = "handshake-failed"
)

var waveSshConfigUserSettingsInternal *ssh_config.UserSettings
var configUserSettingsOnce = &sync.Once{}

func WaveSshConfigUserSettings() *ssh_config.UserSettings {
	configUserSettingsOnce.Do(func() {
		waveSshConfigUserSettingsInternal = ssh_config.DefaultUserSettings
		waveSshConfigUserSettingsInternal.IgnoreMatchDirective = true
	})
	return waveSshConfigUserSettingsInternal
}

type UserInputCancelError struct {
	Err error
}

type HostKeyAlgorithms = func(hostWithPort string) (algos []string)

func (uice UserInputCancelError) Error() string {
	return uice.Err.Error()
}

func (uice UserInputCancelError) Unwrap() error {
	return uice.Err
}

type ConnectionDebugInfo struct {
	CurrentClient *ssh.Client
	NextOpts      *SSHOpts
	JumpNum       int32
}

type ConnectionError struct {
	*ConnectionDebugInfo
	Err error
}

func (ce ConnectionError) Error() string {
	if ce.CurrentClient == nil {
		return fmt.Sprintf("Connecting to %s, Error: %v", ce.NextOpts, ce.Err)
	}
	return fmt.Sprintf("Connecting from %v to %s (jump number %d), Error: %v", ce.CurrentClient, ce.NextOpts, ce.JumpNum, ce.Err)
}

func (ce ConnectionError) Unwrap() error {
	return ce.Err
}

func SimpleMessageFromPossibleConnectionError(err error) string {
	if err == nil {
		return ""
	}
	if ce, ok := err.(ConnectionError); ok {
		return ce.Err.Error()
	}
	return err.Error()
}

func ClassifyConnError(err error) (string, string) {
	code := utilds.GetErrorCode(err)
	subCode := utilds.GetErrorSubCode(err)
	if code != "" {
		return code, subCode
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return ConnErrCode_Dial, ClassifyDialErrorSubCode(err)
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return ConnErrCode_Dial, ClassifyDialErrorSubCode(err)
	}
	errStr := err.Error()
	if strings.Contains(errStr, "unable to authenticate") {
		return ConnErrCode_AuthFailed, AuthSubCode_UnableToAuth
	}
	if strings.Contains(errStr, "handshake failed") {
		return ConnErrCode_AuthFailed, AuthSubCode_HandshakeFailed
	}
	if strings.Contains(errStr, "connection refused") {
		return ConnErrCode_Dial, ClassifyDialErrorSubCode(err)
	}
	if strings.Contains(errStr, "timed out") || strings.Contains(errStr, "timeout") {
		return ConnErrCode_Dial, ClassifyDialErrorSubCode(err)
	}
	return ConnErrCode_Unknown, ""
}

// ClassifyDialErrorSubCode provides more granular classification of dial errors
// to help identify root causes (DNS, VPN, timeouts, etc.)
func ClassifyDialErrorSubCode(err error) string {
	if err == nil {
		return ""
	}

	// Check for context cancellation first
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return DialSubCode_ContextCanceled
	}

	// Check if it's a DNS error
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return DialSubCode_DNS
	}

	// Check if it's a network operation error
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		// Check the underlying error for more details
		if opErr.Err != nil {
			errStr := opErr.Err.Error()
			if strings.Contains(errStr, "connection refused") {
				return DialSubCode_Refused
			}
			if strings.Contains(errStr, "no route to host") {
				return DialSubCode_NoRoute
			}
			if strings.Contains(errStr, "host is unreachable") || strings.Contains(errStr, "host unreachable") {
				return DialSubCode_HostUnreach
			}
			if strings.Contains(errStr, "network is unreachable") || strings.Contains(errStr, "network unreachable") {
				return DialSubCode_NetUnreach
			}
			if strings.Contains(errStr, "connection reset") {
				return DialSubCode_ConnReset
			}
			if strings.Contains(errStr, "permission denied") {
				return DialSubCode_PermDenied
			}
		}
		// Generic timeout detection in OpError
		if opErr.Timeout() {
			return DialSubCode_Timeout
		}
	}

	// Check error string for common patterns
	errStr := err.Error()
	if strings.Contains(errStr, "connection refused") {
		return DialSubCode_Refused
	}
	if strings.Contains(errStr, "timed out") || strings.Contains(errStr, "timeout") || strings.Contains(errStr, "i/o timeout") {
		return DialSubCode_Timeout
	}
	if strings.Contains(errStr, "no route to host") {
		return DialSubCode_NoRoute
	}
	if strings.Contains(errStr, "host is unreachable") || strings.Contains(errStr, "host unreachable") {
		return DialSubCode_HostUnreach
	}
	if strings.Contains(errStr, "network is unreachable") || strings.Contains(errStr, "network unreachable") {
		return DialSubCode_NetUnreach
	}
	if strings.Contains(errStr, "connection reset") {
		return DialSubCode_ConnReset
	}
	if strings.Contains(errStr, "permission denied") {
		return DialSubCode_PermDenied
	}

	return DialSubCode_Other
}

// This exists to trick the ssh library into continuing to try
// different public keys even when the current key cannot be
// properly parsed
func createDummySigner() ([]ssh.Signer, error) {
	dummyKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	dummySigner, err := ssh.NewSignerFromKey(dummyKey)
	if err != nil {
		return nil, err
	}
	return []ssh.Signer{dummySigner}, nil

}

// This is a workaround to only process one identity file at a time,
// even if they have passphrases. It must be combined with retryable
// authentication to work properly
//
// Despite returning an array of signers, we only ever provide one since
// it allows proper user interaction in between attempts
//
// A significant number of errors end up returning dummy values as if
// they were successes. An error in this function prevents any other
// keys from being attempted. But if there's an error because of a dummy
// file, the library can still try again with a new key.
func createPublicKeyCallback(connCtx context.Context, sshKeywords *wconfig.ConnKeywords, authSockSignersExt []ssh.Signer, agentClient agent.ExtendedAgent, debugInfo *ConnectionDebugInfo) func() ([]ssh.Signer, error) {
	var identityFiles []string
	existingKeys := make(map[string][]byte)

	// checking the file early prevents us from needing to send a
	// dummy signer if there's a problem with the signer
	for _, identityFile := range sshKeywords.SshIdentityFile {
		filePath, err := wavebase.ExpandHomeDir(identityFile)
		if err != nil {
			continue
		}
		privateKey, err := os.ReadFile(filePath)
		if err != nil {
			// skip this key and try with the next
			continue
		}
		existingKeys[identityFile] = privateKey
		identityFiles = append(identityFiles, identityFile)
	}
	// require pointer to modify list in closure
	identityFilesPtr := &identityFiles

	var authSockSigners []ssh.Signer
	authSockSigners = append(authSockSigners, authSockSignersExt...)
	authSockSignersPtr := &authSockSigners

	return func() (outSigner []ssh.Signer, outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:publickey-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		// try auth sock
		if len(*authSockSignersPtr) != 0 {
			authSockSigner := (*authSockSignersPtr)[0]
			*authSockSignersPtr = (*authSockSignersPtr)[1:]
			return []ssh.Signer{authSockSigner}, nil
		}

		if len(*identityFilesPtr) == 0 {
			return nil, ConnectionError{ConnectionDebugInfo: debugInfo, Err: fmt.Errorf("no identity files remaining")}
		}
		identityFile := (*identityFilesPtr)[0]
		blocklogger.Infof(connCtx, "[conndebug] trying keyfile %q...\n", identityFile)
		*identityFilesPtr = (*identityFilesPtr)[1:]
		privateKey, ok := existingKeys[identityFile]
		if !ok {
			log.Printf("error with existingKeys, this should never happen")
			// skip this key and try with the next
			return createDummySigner()
		}

		unencryptedPrivateKey, err := ssh.ParseRawPrivateKey(privateKey)
		if err == nil {
			signer, err := ssh.NewSignerFromKey(unencryptedPrivateKey)
			if err == nil {
				if utilfn.SafeDeref(sshKeywords.SshAddKeysToAgent) && agentClient != nil {
					agentClient.Add(agent.AddedKey{
						PrivateKey: unencryptedPrivateKey,
					})
				}
				return []ssh.Signer{signer}, nil
			}
		}
		if _, ok := err.(*ssh.PassphraseMissingError); !ok {
			// skip this key and try with the next
			return createDummySigner()
		}

		// batch mode deactivates user input
		if utilfn.SafeDeref(sshKeywords.SshBatchMode) {
			// skip this key and try with the next
			return createDummySigner()
		}

		request := &userinput.UserInputRequest{
			ResponseType: "text",
			QueryText:    fmt.Sprintf("Enter passphrase for the SSH key: %s", identityFile),
			Title:        "Publickey Auth + Passphrase",
		}
		ctx, cancelFn := context.WithTimeout(connCtx, 60*time.Second)
		defer cancelFn()
		response, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			// this is an error where we actually do want to stop
			// trying keys

			return nil, ConnectionError{ConnectionDebugInfo: debugInfo, Err: utilds.MakeCodedError(ConnErrCode_UserCancelled, UserInputCancelError{Err: err})}
		}
		unencryptedPrivateKey, err = ssh.ParseRawPrivateKeyWithPassphrase(privateKey, []byte([]byte(response.Text)))
		if err != nil {
			// skip this key and try with the next
			return createDummySigner()
		}
		signer, err := ssh.NewSignerFromKey(unencryptedPrivateKey)
		if err != nil {
			// skip this key and try with the next
			return createDummySigner()
		}
		if utilfn.SafeDeref(sshKeywords.SshAddKeysToAgent) && agentClient != nil {
			agentClient.Add(agent.AddedKey{
				PrivateKey: unencryptedPrivateKey,
			})
		}
		return []ssh.Signer{signer}, nil
	}
}

func createPasswordCallbackPrompt(connCtx context.Context, remoteDisplayName string, password *string, debugInfo *ConnectionDebugInfo) func() (secret string, err error) {
	return func() (secret string, outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:password-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		blocklogger.Infof(connCtx, "[conndebug] Password Authentication requested from connection %s...\n", remoteDisplayName)

		if password != nil {
			blocklogger.Infof(connCtx, "[conndebug] using password from secret store, sending to ssh\n")
			return *password, nil
		}

		ctx, cancelFn := context.WithTimeout(connCtx, 60*time.Second)
		defer cancelFn()
		queryText := fmt.Sprintf(
			"Password Authentication requested from connection  \n"+
				"%s\n\n"+
				"Password:", remoteDisplayName)
		request := &userinput.UserInputRequest{
			ResponseType: "text",
			QueryText:    queryText,
			Markdown:     true,
			Title:        "Password Authentication",
		}
		response, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			blocklogger.Infof(connCtx, "[conndebug] ERROR Password Authentication failed: %v\n", SimpleMessageFromPossibleConnectionError(err))
			return "", ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}
		blocklogger.Infof(connCtx, "[conndebug] got password from user, sending to ssh\n")
		return response.Text, nil
	}
}

func createInteractiveKbdInteractiveChallenge(connCtx context.Context, remoteName string, debugInfo *ConnectionDebugInfo) func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
	return func(name, instruction string, questions []string, echos []bool) (answers []string, outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:kbdinteractive-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		if len(questions) != len(echos) {
			return nil, fmt.Errorf("bad response from server: questions has len %d, echos has len %d", len(questions), len(echos))
		}
		for i, question := range questions {
			echo := echos[i]
			answer, err := promptChallengeQuestion(connCtx, question, echo, remoteName)
			if err != nil {
				return nil, ConnectionError{ConnectionDebugInfo: debugInfo, Err: utilds.MakeCodedError(ConnErrCode_UserCancelled, err)}
			}
			answers = append(answers, answer)
		}
		return answers, nil
	}
}

func promptChallengeQuestion(connCtx context.Context, question string, echo bool, remoteName string) (answer string, err error) {
	// limited to 15 seconds for some reason. this should be investigated more
	// in the future
	ctx, cancelFn := context.WithTimeout(connCtx, 60*time.Second)
	defer cancelFn()
	queryText := fmt.Sprintf(
		"Keyboard Interactive Authentication requested from connection  \n"+
			"%s\n\n"+
			"%s", remoteName, question)
	request := &userinput.UserInputRequest{
		ResponseType: "text",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Keyboard Interactive Authentication",
		PublicText:   echo,
	}
	response, err := userinput.GetUserInput(ctx, request)
	if err != nil {
		return "", err
	}
	return response.Text, nil
}

func openKnownHostsForEdit(knownHostsFilename string) (*os.File, error) {
	path, _ := filepath.Split(knownHostsFilename)
	err := os.MkdirAll(path, 0700)
	if err != nil {
		return nil, err
	}
	return os.OpenFile(knownHostsFilename, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
}

func writeToKnownHosts(knownHostsFile string, newLine string, getUserVerification func() (*userinput.UserInputResponse, error)) error {
	if getUserVerification == nil {
		getUserVerification = func() (*userinput.UserInputResponse, error) {
			return &userinput.UserInputResponse{
				Type:    "confirm",
				Confirm: true,
			}, nil
		}
	}

	path, _ := filepath.Split(knownHostsFile)
	err := os.MkdirAll(path, 0700)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		return err
	}
	// do not close writeable files with defer

	// this file works, so let's ask the user for permission
	response, err := getUserVerification()
	if err != nil {
		f.Close()
		return UserInputCancelError{Err: err}
	}
	if !response.Confirm {
		f.Close()
		return UserInputCancelError{Err: fmt.Errorf("canceled by the user")}
	}

	_, err = f.WriteString(newLine + "\n")
	if err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func createUnknownKeyVerifier(ctx context.Context, knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*userinput.UserInputResponse, error) {
	base64Key := base64.StdEncoding.EncodeToString(key.Marshal())
	queryText := fmt.Sprintf(
		"The authenticity of host '%s (%s)' can't be established "+
			"as it **does not exist in any checked known_hosts files**. "+
			"The host you are attempting to connect to provides this %s key:  \n"+
			"%s.\n\n"+
			"**Would you like to continue connecting?** If so, the key will be permanently "+
			"added to the file %s "+
			"to protect from future man-in-the-middle attacks.", hostname, remote, key.Type(), base64Key, knownHostsFile)
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Known Hosts Key Missing",
	}
	return func() (*userinput.UserInputResponse, error) {
		ctx, cancelFn := context.WithTimeout(ctx, 60*time.Second)
		defer cancelFn()
		resp, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			return nil, err
		}
		if !resp.Confirm {
			return nil, fmt.Errorf("user selected no")
		}
		return resp, nil
	}
}

func createMissingKnownHostsVerifier(knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*userinput.UserInputResponse, error) {
	base64Key := base64.StdEncoding.EncodeToString(key.Marshal())
	queryText := fmt.Sprintf(
		"The authenticity of host '%s (%s)' can't be established "+
			"as **no known_hosts files could be found**. "+
			"The host you are attempting to connect to provides this %s key:  \n"+
			"%s.\n\n"+
			"**Would you like to continue connecting?** If so:  \n"+
			"- %s will be created  \n"+
			"- the key will be added to %s\n\n"+
			"This will protect from future man-in-the-middle attacks.", hostname, remote, key.Type(), base64Key, knownHostsFile, knownHostsFile)
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Known Hosts File Missing",
	}
	return func() (*userinput.UserInputResponse, error) {
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		resp, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			return nil, err
		}
		if !resp.Confirm {
			return nil, fmt.Errorf("user selected no")
		}
		return resp, nil
	}
}

func lineContainsMatch(line []byte, matches [][]byte) bool {
	for _, match := range matches {
		if bytes.Contains(line, match) {
			return true
		}
	}
	return false
}

func createHostKeyCallback(ctx context.Context, sshKeywords *wconfig.ConnKeywords, strictHostKeyChecking string) (ssh.HostKeyCallback, HostKeyAlgorithms, error) {
	strictMode := strings.ToLower(strings.TrimSpace(strictHostKeyChecking))
	if strictMode == "no" || strictMode == "off" {
		blocklogger.Infof(ctx, "[conndebug] StrictHostKeyChecking=%s: skipping host key verification\n", strictMode)
		return ssh.InsecureIgnoreHostKey(), func(hostWithPort string) []string { return nil }, nil
	}

	globalKnownHostsFiles := sshKeywords.SshGlobalKnownHostsFile
	userKnownHostsFiles := sshKeywords.SshUserKnownHostsFile

	osUser, err := user.Current()
	if err != nil {
		return nil, nil, utilds.MakeCodedError(ConnErrCode_ConfigParse, err)
	}
	var unexpandedKnownHostsFiles []string
	if osUser.Username == "root" {
		unexpandedKnownHostsFiles = globalKnownHostsFiles
	} else {
		unexpandedKnownHostsFiles = append(userKnownHostsFiles, globalKnownHostsFiles...)
	}

	var knownHostsFiles []string
	for _, filename := range unexpandedKnownHostsFiles {
		filePath, err := wavebase.ExpandHomeDir(filename)
		if err != nil {
			continue
		}
		knownHostsFiles = append(knownHostsFiles, filePath)
	}

	// there are no good known hosts files
	if len(knownHostsFiles) == 0 {
		return nil, nil, utilds.Errorf(ConnErrCode_KnownHostsNone, "no known_hosts files provided by ssh. defaults are overridden")
	}

	var unreadableFiles []string

	// the library we use isn't very forgiving about files that are formatted
	// incorrectly. if a problem file is found, it is removed from our list
	// and we try again
	var basicCallback ssh.HostKeyCallback
	var hostKeyAlgorithms HostKeyAlgorithms
	for basicCallback == nil && len(knownHostsFiles) > 0 {
		keyDb, err := knownhosts.NewDB(knownHostsFiles...)
		if serr, ok := err.(*os.PathError); ok {
			badFile := serr.Path
			unreadableFiles = append(unreadableFiles, badFile)
			var okFiles []string
			for _, filename := range knownHostsFiles {
				if filename != badFile {
					okFiles = append(okFiles, filename)
				}
			}
			if len(okFiles) >= len(knownHostsFiles) {
				return nil, nil, utilds.Errorf(ConnErrCode_KnownHostsFmt, "problem file (%s) doesn't exist. this should not be possible", badFile)
			}
			knownHostsFiles = okFiles
		} else if err != nil {
			return nil, nil, utilds.Errorf(ConnErrCode_KnownHostsFmt, "known_hosts formatting error: %w", err)
		} else {
			basicCallback = keyDb.HostKeyCallback()
			hostKeyAlgorithms = keyDb.HostKeyAlgorithms
		}
	}

	if basicCallback == nil {
		basicCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			return &xknownhosts.KeyError{}
		}
		// need to return nil here to avoid null pointer from attempting to call
		// the one provided by the db if nothing was found
		hostKeyAlgorithms = func(hostWithPort string) (algos []string) {
			return nil
		}
	}

	waveHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) (outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:wave-hostkey-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		err := basicCallback(hostname, remote, key)
		if err == nil {
			// success
			return nil
		} else if _, ok := err.(*xknownhosts.RevokedError); ok {
			return utilds.MakeCodedError(ConnErrCode_HostKeyRevoked, err)
		} else if _, ok := err.(*xknownhosts.KeyError); !ok {
			// this is an unknown error (note the !ok is opposite of usual)
			return err
		}
		serr, _ := err.(*xknownhosts.KeyError)
		if len(serr.Want) == 0 {
			// the key was not found
			if strictMode == "yes" {
				return utilds.Errorf(ConnErrCode_HostKeyVerify, "host key for %s not found in known_hosts (StrictHostKeyChecking=yes)", hostname)
			}

			// try to write to a file that could be read
			err := fmt.Errorf("placeholder, should not be returned") // a null value here can cause problems with empty slice
			for _, filename := range knownHostsFiles {
				newLine := xknownhosts.Line([]string{xknownhosts.Normalize(hostname)}, key)
				var getUserVerification func() (*userinput.UserInputResponse, error)
				if strictMode != "accept-new" {
					getUserVerification = createUnknownKeyVerifier(ctx, filename, hostname, remote.String(), key)
				}
				err = writeToKnownHosts(filename, newLine, getUserVerification)
				if err == nil {
					break
				}
				if serr, ok := err.(UserInputCancelError); ok {
					return utilds.MakeCodedError(ConnErrCode_UserCancelled, serr)
				}
			}

			// try to write to a file that could not be read (file likely doesn't exist)
			// should catch cases where there is no known_hosts file
			if err != nil {
				for _, filename := range unreadableFiles {
					newLine := xknownhosts.Line([]string{xknownhosts.Normalize(hostname)}, key)
					var getUserVerification func() (*userinput.UserInputResponse, error)
					if strictMode != "accept-new" {
						getUserVerification = createMissingKnownHostsVerifier(filename, hostname, remote.String(), key)
					}
					err = writeToKnownHosts(filename, newLine, getUserVerification)
					if err == nil {
						knownHostsFiles = []string{filename}
						break
					}
					if serr, ok := err.(UserInputCancelError); ok {
						return utilds.MakeCodedError(ConnErrCode_UserCancelled, serr)
					}
				}
			}
			if err != nil {
				return utilds.Errorf(ConnErrCode_HostKeyVerify, "unable to create new knownhost key: %w", err)
			}
		} else {
			// the key changed
			correctKeyFingerprint := base64.StdEncoding.EncodeToString(key.Marshal())
			var bulletListKnownHosts []string
			for _, knownHostName := range knownHostsFiles {
				withBulletPoint := "- " + knownHostName
				bulletListKnownHosts = append(bulletListKnownHosts, withBulletPoint)
			}
			var offendingKeysFmt []string
			for _, badKey := range serr.Want {
				formattedKey := "- " + base64.StdEncoding.EncodeToString(badKey.Key.Marshal())
				offendingKeysFmt = append(offendingKeysFmt, formattedKey)
			}
			// todo
			errorMsg := fmt.Sprintf("**WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!**\n\n"+
				"If this is not expected, it is possible that someone could be trying to "+
				"eavesdrop on you via a man-in-the-middle attack. "+
				"Alternatively, the host you are connecting to may have changed its key. "+
				"The %s key sent by the remote hist has the fingerprint:  \n"+
				"%s\n\n"+
				"If you are sure this is correct, please update your known_hosts files to "+
				"remove the lines with the offending before trying to connect again.  \n"+
				"**Known Hosts Files**  \n"+
				"%s\n\n"+
				"**Offending Keys**  \n"+
				"%s", key.Type(), correctKeyFingerprint, strings.Join(bulletListKnownHosts, "  \n"), strings.Join(offendingKeysFmt, "  \n"))

			log.Print(errorMsg)
			//update := scbus.MakeUpdatePacket()
			// create update into alert message

			//send update via bus?
			return utilds.Errorf(ConnErrCode_HostKeyChanged, "remote host identification has changed")
		}

		updatedCallback, err := xknownhosts.New(knownHostsFiles...)
		if err != nil {
			return err
		}
		// try one final time
		return updatedCallback(hostname, remote, key)
	}

	return waveHostKeyCallback, hostKeyAlgorithms, nil
}

func createClientConfig(connCtx context.Context, sshKeywords *wconfig.ConnKeywords, debugInfo *ConnectionDebugInfo, strictHostKeyChecking string) (*ssh.ClientConfig, error) {
	chosenUser := utilfn.SafeDeref(sshKeywords.SshUser)
	chosenHostName := utilfn.SafeDeref(sshKeywords.SshHostName)
	chosenPort := utilfn.SafeDeref(sshKeywords.SshPort)
	remoteName := xknownhosts.Normalize(chosenHostName + ":" + chosenPort)
	if chosenUser != "" {
		remoteName = chosenUser + "@" + remoteName
	}

	var authSockSigners []ssh.Signer
	var agentClient agent.ExtendedAgent

	// IdentitiesOnly indicates that only the keys listed in the identity and certificate files or passed as arguments should be used, even if there are matches in the SSH Agent, PKCS11Provider, or SecurityKeyProvider. See https://man.openbsd.org/ssh_config#IdentitiesOnly
	// TODO: Update if we decide to support PKCS11Provider and SecurityKeyProvider
	agentPath := strings.TrimSpace(utilfn.SafeDeref(sshKeywords.SshIdentityAgent))
	if !utilfn.SafeDeref(sshKeywords.SshIdentitiesOnly) && agentPath != "" {
		conn, err := dialIdentityAgent(agentPath)
		if err != nil {
			log.Printf("Failed to open Identity Agent Socket %q: %v", agentPath, err)
		} else {
			agentClient = agent.NewClient(conn)
			authSockSigners, _ = agentClient.Signers()
		}
	}

	var sshPassword *string
	if sshKeywords.SshPasswordSecretName != nil && *sshKeywords.SshPasswordSecretName != "" {
		secretName := *sshKeywords.SshPasswordSecretName
		password, exists, err := secretstore.GetSecret(secretName)
		if err != nil {
			return nil, utilds.Errorf(ConnErrCode_SecretStore, "error retrieving ssh:passwordsecretname %q: %w", secretName, err)
		}
		if !exists {
			return nil, utilds.Errorf(ConnErrCode_SecretNotFound, "ssh:passwordsecretname %q not found in secret store", secretName)
		}
		blocklogger.Infof(connCtx, "[conndebug] successfully retrieved ssh:passwordsecretname %q from secret store\n", secretName)
		sshPassword = &password
	}

	publicKeyCallback := ssh.PublicKeysCallback(createPublicKeyCallback(connCtx, sshKeywords, authSockSigners, agentClient, debugInfo))
	keyboardInteractive := ssh.KeyboardInteractive(createInteractiveKbdInteractiveChallenge(connCtx, remoteName, debugInfo))
	passwordCallback := ssh.PasswordCallback(createPasswordCallbackPrompt(connCtx, remoteName, sshPassword, debugInfo))

	// exclude gssapi-with-mic and hostbased until implemented
	authMethodMap := map[string]ssh.AuthMethod{
		"publickey":            ssh.RetryableAuthMethod(publicKeyCallback, len(sshKeywords.SshIdentityFile)+len(authSockSigners)),
		"keyboard-interactive": ssh.RetryableAuthMethod(keyboardInteractive, 1),
		"password":             ssh.RetryableAuthMethod(passwordCallback, 1),
	}

	// note: batch mode turns off interactive input
	authMethodActiveMap := map[string]bool{
		"publickey":            utilfn.SafeDeref(sshKeywords.SshPubkeyAuthentication),
		"keyboard-interactive": utilfn.SafeDeref(sshKeywords.SshKbdInteractiveAuthentication) && !utilfn.SafeDeref(sshKeywords.SshBatchMode),
		"password":             utilfn.SafeDeref(sshKeywords.SshPasswordAuthentication) && !utilfn.SafeDeref(sshKeywords.SshBatchMode),
	}

	var authMethods []ssh.AuthMethod
	for _, authMethodName := range sshKeywords.SshPreferredAuthentications {
		authMethodActive, ok := authMethodActiveMap[authMethodName]
		if !ok || !authMethodActive {
			continue
		}
		authMethod, ok := authMethodMap[authMethodName]
		if !ok {
			continue
		}
		authMethods = append(authMethods, authMethod)
	}

	hostKeyCallback, hostKeyAlgorithms, err := createHostKeyCallback(connCtx, sshKeywords, strictHostKeyChecking)
	if err != nil {
		return nil, err
	}

	networkAddr := chosenHostName + ":" + chosenPort
	return &ssh.ClientConfig{
		User:              chosenUser,
		Auth:              authMethods,
		HostKeyCallback:   hostKeyCallback,
		HostKeyAlgorithms: hostKeyAlgorithms(networkAddr),
	}, nil
}

var (
	proxyHostAllowlistRe = regexp.MustCompile(`^[a-zA-Z0-9._:-]+$`)
	proxyUserAllowlistRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
)

func validateProxyHost(host string) error {
	if host == "" || strings.HasPrefix(host, "-") || !proxyHostAllowlistRe.MatchString(host) {
		return fmt.Errorf("invalid ProxyCommand host token %q", host)
	}
	return nil
}

func validateProxyPort(port string) error {
	if port == "" {
		return fmt.Errorf("invalid ProxyCommand port token %q", port)
	}
	for i := 0; i < len(port); i++ {
		if port[i] < '0' || port[i] > '9' {
			return fmt.Errorf("invalid ProxyCommand port token %q", port)
		}
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		return fmt.Errorf("invalid ProxyCommand port token %q", port)
	}
	return nil
}

func validateProxyUser(userName string) error {
	if userName == "" || strings.HasPrefix(userName, "-") || !proxyUserAllowlistRe.MatchString(userName) {
		return fmt.Errorf("invalid ProxyCommand user token %q", userName)
	}
	return nil
}

// splitProxyCommandArgs performs quote-aware argv splitting without invoking a shell.
func splitProxyCommandArgs(cmdStr string) ([]string, error) {
	var args []string
	var current strings.Builder
	inToken := false
	inSingle := false
	inDouble := false

	for i := 0; i < len(cmdStr); i++ {
		ch := cmdStr[i]
		if inSingle {
			if ch == '\'' {
				inSingle = false
			} else {
				current.WriteByte(ch)
			}
			continue
		}
		if inDouble {
			if ch == '"' {
				inDouble = false
			} else if ch == '\\' && i+1 < len(cmdStr) && (cmdStr[i+1] == '"' || cmdStr[i+1] == '\\') {
				i++
				current.WriteByte(cmdStr[i])
			} else {
				current.WriteByte(ch)
			}
			continue
		}
		switch ch {
		case ' ', '\t', '\r', '\n':
			if inToken {
				args = append(args, current.String())
				current.Reset()
				inToken = false
			}
		case '\'':
			inSingle = true
			inToken = true
		case '"':
			inDouble = true
			inToken = true
		case '\\':
			inToken = true
			if i+1 < len(cmdStr) && (cmdStr[i+1] == ' ' || cmdStr[i+1] == '\t' || cmdStr[i+1] == '"' || cmdStr[i+1] == '\'' || cmdStr[i+1] == '\\') {
				i++
				current.WriteByte(cmdStr[i])
			} else {
				current.WriteByte(ch)
			}
		default:
			inToken = true
			current.WriteByte(ch)
		}
	}
	if inSingle || inDouble {
		return nil, fmt.Errorf("unterminated quote in ProxyCommand")
	}
	if inToken {
		args = append(args, current.String())
	}
	if len(args) == 0 {
		return nil, fmt.Errorf("empty ProxyCommand")
	}
	return args, nil
}

func expandProxyCommandTokens(rawArgs []string, host, port, userName string) ([]string, error) {
	expanded := make([]string, len(rawArgs))
	for idx, arg := range rawArgs {
		var b strings.Builder
		for i := 0; i < len(arg); i++ {
			if arg[i] != '%' {
				b.WriteByte(arg[i])
				continue
			}
			if i+1 >= len(arg) {
				return nil, fmt.Errorf("trailing '%%' in ProxyCommand argument %q", arg)
			}
			i++
			switch arg[i] {
			case '%':
				b.WriteByte('%')
			case 'h':
				if err := validateProxyHost(host); err != nil {
					return nil, err
				}
				b.WriteString(host)
			case 'p':
				if err := validateProxyPort(port); err != nil {
					return nil, err
				}
				b.WriteString(port)
			case 'r':
				if err := validateProxyUser(userName); err != nil {
					return nil, err
				}
				b.WriteString(userName)
			default:
				return nil, fmt.Errorf("unsupported ProxyCommand token '%%%c'", arg[i])
			}
		}
		expanded[idx] = b.String()
	}
	return expanded, nil
}

func buildProxyCommandArgs(proxyCmd, host, port, userName string) ([]string, error) {
	rawArgs, err := splitProxyCommandArgs(proxyCmd)
	if err != nil {
		return nil, err
	}
	return expandProxyCommandTokens(rawArgs, host, port, userName)
}

type proxyAddr struct {
	addr string
}

func (a proxyAddr) Network() string { return "proxycommand" }
func (a proxyAddr) String() string  { return a.addr }

type proxyCmdConn struct {
	cmd        *exec.Cmd
	cancel     context.CancelFunc
	stdin      io.WriteCloser
	stdout     io.ReadCloser
	remoteAddr net.Addr
	closeOnce  sync.Once
}

func (c *proxyCmdConn) Read(p []byte) (int, error) {
	return c.stdout.Read(p)
}

func (c *proxyCmdConn) Write(p []byte) (int, error) {
	return c.stdin.Write(p)
}

func (c *proxyCmdConn) Close() error {
	var firstErr error
	c.closeOnce.Do(func() {
		c.cancel()
		if err := c.stdin.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		if err := c.stdout.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
		killProxyCmdProcess(c.cmd)
		go func() {
			_ = c.cmd.Wait()
		}()
	})
	return firstErr
}

func (c *proxyCmdConn) LocalAddr() net.Addr                { return proxyAddr{addr: "local"} }
func (c *proxyCmdConn) RemoteAddr() net.Addr               { return c.remoteAddr }
func (c *proxyCmdConn) SetDeadline(t time.Time) error      { return nil }
func (c *proxyCmdConn) SetReadDeadline(t time.Time) error  { return nil }
func (c *proxyCmdConn) SetWriteDeadline(t time.Time) error { return nil }

func dialProxyCommand(ctx context.Context, proxyCmd, host, port, userName string) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	argv, err := buildProxyCommandArgs(proxyCmd, host, port, userName)
	if err != nil {
		return nil, err
	}
	proxyCtx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(proxyCtx, argv[0], argv[1:]...)
	configureProxyCmdSysProcAttr(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("proxycommand stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("proxycommand stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("proxycommand start %q: %w", argv[0], err)
	}
	return &proxyCmdConn{
		cmd:        cmd,
		cancel:     cancel,
		stdin:      stdin,
		stdout:     stdout,
		remoteAddr: proxyAddr{addr: host + ":" + port},
	}, nil
}

func connectInternal(ctx context.Context, networkAddr string, clientConfig *ssh.ClientConfig, currentClient *ssh.Client, proxyCmd string, host string, port string, userName string) (*ssh.Client, error) {
	var clientConn net.Conn
	var err error
	if currentClient == nil {
		if proxyCmd != "" {
			blocklogger.Infof(ctx, "[conndebug] ssh dial via ProxyCommand for %s\n", networkAddr)
			clientConn, err = dialProxyCommand(ctx, proxyCmd, host, port, userName)
			if err != nil {
				subCode := ClassifyDialErrorSubCode(err)
				blocklogger.Infof(ctx, "[conndebug] ERROR proxycommand dial error [%s]: %v\n", subCode, err)
				return nil, utilds.MakeSubCodedError(ConnErrCode_Dial, subCode, err)
			}
		} else {
			d := net.Dialer{Timeout: clientConfig.Timeout}
			blocklogger.Infof(ctx, "[conndebug] ssh dial %s\n", networkAddr)
			clientConn, err = d.DialContext(ctx, "tcp", networkAddr)
			if err != nil {
				subCode := ClassifyDialErrorSubCode(err)
				blocklogger.Infof(ctx, "[conndebug] ERROR dial error [%s]: %v\n", subCode, err)
				return nil, utilds.MakeSubCodedError(ConnErrCode_Dial, subCode, err)
			}
		}
	} else {
		blocklogger.Infof(ctx, "[conndebug] ssh dial (from client) %s\n", networkAddr)
		clientConn, err = currentClient.DialContext(ctx, "tcp", networkAddr)
		if err != nil {
			subCode := ClassifyDialErrorSubCode(err)
			blocklogger.Infof(ctx, "[conndebug] ERROR dial error [%s]: %v\n", subCode, err)
			return nil, utilds.MakeSubCodedError(ConnErrCode_ProxyJumpDial, subCode, err)
		}
	}
	c, chans, reqs, err := ssh.NewClientConn(clientConn, networkAddr, clientConfig)
	if err != nil {
		_ = clientConn.Close()
		blocklogger.Infof(ctx, "[conndebug] ERROR ssh auth/negotiation: %s\n", SimpleMessageFromPossibleConnectionError(err))
		return nil, err
	}
	blocklogger.Infof(ctx, "[conndebug] successful ssh connection to %s\n", networkAddr)
	return ssh.NewClient(c, chans, reqs), nil
}

func ConnectToClient(connCtx context.Context, opts *SSHOpts, currentClient *ssh.Client, jumpNum int32, connFlags *wconfig.ConnKeywords) (*ssh.Client, int32, error) {
	blocklogger.Infof(connCtx, "[conndebug] ConnectToClient %s (jump:%d)...\n", opts.String(), jumpNum)
	debugInfo := &ConnectionDebugInfo{
		CurrentClient: currentClient,
		NextOpts:      opts,
		JumpNum:       jumpNum,
	}
	if jumpNum > SshProxyJumpMaxDepth {
		return nil, jumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: utilds.Errorf(ConnErrCode_ProxyDepth, "ProxyJump %d exceeds Wave's max depth of %d", jumpNum, SshProxyJumpMaxDepth)}
	}

	rawName := opts.String()
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	internalSshConfigKeywords, ok := fullConfig.Connections[rawName]
	if !ok {
		internalSshConfigKeywords = wconfig.ConnKeywords{}
	}

	var sshConfigKeywords *wconfig.ConnKeywords
	var proxyCommand string
	var strictHostKeyChecking string
	if utilfn.SafeDeref(internalSshConfigKeywords.ConnIgnoreSshConfig) {
		var err error
		sshConfigKeywords, err = findSshDefaults(opts.SSHHost)
		if err != nil {
			err = utilds.MakeCodedError(ConnErrCode_ConfigDefault, fmt.Errorf("cannot determine default config keywords: %w", err))
			return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}
	} else {
		var err error
		sshConfigKeywords, err = findSshConfigKeywords(opts.SSHHost)
		if err != nil {
			err = utilds.MakeCodedError(ConnErrCode_ConfigParse, fmt.Errorf("cannot determine config keywords: %w", err))
			return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}
		// Security: ProxyCommand and StrictHostKeyChecking are read exclusively from ~/.ssh/config
		// and are never overridable via untrusted RPC flags.
		if pcRaw, pcErr := WaveSshConfigUserSettings().GetStrict(opts.SSHHost, "ProxyCommand"); pcErr == nil {
			pcTrimmed := strings.TrimSpace(pcRaw)
			if pcTrimmed != "" && !strings.EqualFold(pcTrimmed, "none") {
				proxyCommand = pcTrimmed
			}
		}
		if shkcRaw, shkcErr := WaveSshConfigUserSettings().GetStrict(opts.SSHHost, "StrictHostKeyChecking"); shkcErr == nil {
			strictHostKeyChecking = strings.ToLower(trimquotes.TryTrimQuotes(strings.TrimSpace(shkcRaw)))
		}
	}

	parsedKeywords := &wconfig.ConnKeywords{}
	if opts.SSHUser != "" {
		parsedKeywords.SshUser = &opts.SSHUser
	}
	if opts.SSHPort != "" {
		parsedKeywords.SshPort = &opts.SSHPort
	}

	// cascade order:
	//   ssh config -> (optional) internal config -> specified flag keywords -> parsed keywords
	partialMerged := sshConfigKeywords
	partialMerged = mergeKeywords(partialMerged, &internalSshConfigKeywords)
	partialMerged = mergeKeywords(partialMerged, connFlags)
	sshKeywords := mergeKeywords(partialMerged, parsedKeywords)

	// handle these separately since
	// - they append
	// - since they append, the order is reversed
	// - there is no reason to not include the internal config
	// - they are never part of the parsedKeywords
	sshKeywords.SshIdentityFile = append(sshKeywords.SshIdentityFile, connFlags.SshIdentityFile...)
	sshKeywords.SshIdentityFile = append(sshKeywords.SshIdentityFile, internalSshConfigKeywords.SshIdentityFile...)
	sshKeywords.SshIdentityFile = append(sshKeywords.SshIdentityFile, sshConfigKeywords.SshIdentityFile...)

	for _, proxyName := range sshKeywords.SshProxyJump {
		proxyOpts, err := ParseOpts(proxyName)
		if err != nil {
			return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: utilds.MakeCodedError(ConnErrCode_ProxyParse, err)}
		}

		// ensure no overflow (this will likely never happen)
		if jumpNum < math.MaxInt32 {
			jumpNum += 1
		}

		// do not apply supplied keywords to proxies - ssh config must be used for that
		debugInfo.CurrentClient, jumpNum, err = ConnectToClient(connCtx, proxyOpts, debugInfo.CurrentClient, jumpNum, &wconfig.ConnKeywords{})
		if err != nil {
			// do not add a context on a recursive call
			// (this can cause a recursive nested context that's arbitrarily deep)
			return nil, jumpNum, err
		}
	}
	clientConfig, err := createClientConfig(connCtx, sshKeywords, debugInfo, strictHostKeyChecking)
	if err != nil {
		return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
	}
	chosenHost := utilfn.SafeDeref(sshKeywords.SshHostName)
	chosenPort := utilfn.SafeDeref(sshKeywords.SshPort)
	chosenUser := utilfn.SafeDeref(sshKeywords.SshUser)
	networkAddr := chosenHost + ":" + chosenPort
	client, err := connectInternal(connCtx, networkAddr, clientConfig, debugInfo.CurrentClient, proxyCommand, chosenHost, chosenPort, chosenUser)
	if err != nil {
		return client, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
	}
	return client, debugInfo.JumpNum, nil
}

// note that a `var == "yes"` will default to false
// but `var != "no"` will default to true
// when given unexpected strings
func findSshConfigKeywords(hostPattern string) (connKeywords *wconfig.ConnKeywords, outErr error) {
	defer func() {
		panicErr := panichandler.PanicHandler("sshclient:find-ssh-config-keywords", recover())
		if panicErr != nil {
			outErr = panicErr
		}
	}()
	WaveSshConfigUserSettings().ReloadConfigs()
	sshKeywords := &wconfig.ConnKeywords{}
	var err error

	userRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "User")
	if err != nil {
		return nil, err
	}
	userClean := trimquotes.TryTrimQuotes(userRaw)
	if userClean == "" {
		userDetails, err := user.Current()
		if err != nil {
			return nil, err
		}
		userClean = userDetails.Username
	}
	sshKeywords.SshUser = &userClean

	hostNameRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "HostName")
	if err != nil {
		return nil, err
	}
	// manually implementing default HostName here as it is not handled by ssh_config library
	hostNameProcessed := trimquotes.TryTrimQuotes(hostNameRaw)
	if hostNameProcessed == "" {
		sshKeywords.SshHostName = &hostPattern
	} else {
		sshKeywords.SshHostName = &hostNameProcessed
	}

	portRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "Port")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPort = utilfn.Ptr(trimquotes.TryTrimQuotes(portRaw))

	identityFileRaw := WaveSshConfigUserSettings().GetAll(hostPattern, "IdentityFile")
	for i := 0; i < len(identityFileRaw); i++ {
		identityFileRaw[i] = trimquotes.TryTrimQuotes(identityFileRaw[i])
	}
	sshKeywords.SshIdentityFile = identityFileRaw

	batchModeRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "BatchMode")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshBatchMode = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(batchModeRaw)) == "yes")

	// we currently do not support host-bound or unbound but will use yes when they are selected
	pubkeyAuthenticationRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "PubkeyAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPubkeyAuthentication = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(pubkeyAuthenticationRaw)) != "no")

	passwordAuthenticationRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "PasswordAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPasswordAuthentication = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(passwordAuthenticationRaw)) != "no")

	kbdInteractiveAuthenticationRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "KbdInteractiveAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshKbdInteractiveAuthentication = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(kbdInteractiveAuthenticationRaw)) != "no")

	// these are parsed as a single string and must be separated
	// these are case sensitive in openssh so they are here too
	preferredAuthenticationsRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "PreferredAuthentications")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPreferredAuthentications = strings.Split(trimquotes.TryTrimQuotes(preferredAuthenticationsRaw), ",")
	addKeysToAgentRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "AddKeysToAgent")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshAddKeysToAgent = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(addKeysToAgentRaw)) == "yes")

	identitiesOnly, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "IdentitiesOnly")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshIdentitiesOnly = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(identitiesOnly)) == "yes")

	identityAgentRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "IdentityAgent")
	if err != nil {
		return nil, err
	}
	if identityAgentRaw == "" {
		if runtime.GOOS == "windows" {
			sshKeywords.SshIdentityAgent = utilfn.Ptr(`\\.\pipe\openssh-ssh-agent`)
		} else {
			shellPath := shellutil.DetectLocalShellPath()
			authSockCommand := exec.Command(shellPath, "-c", "echo ${SSH_AUTH_SOCK}")
			sshAuthSock, err := authSockCommand.Output()
			if err == nil {
				trimmedSock := strings.TrimSpace(string(sshAuthSock))
				if trimmedSock == "" {
					log.Printf("SSH_AUTH_SOCK is empty in shell environment")
				} else {
					agentPath, err := wavebase.ExpandHomeDir(trimquotes.TryTrimQuotes(trimmedSock))
					if err != nil {
						return nil, err
					}
					sshKeywords.SshIdentityAgent = utilfn.Ptr(agentPath)
				}
			} else {
				log.Printf("unable to find SSH_AUTH_SOCK: %v\n", err)
			}
		}
	} else {
		agentPath, err := wavebase.ExpandHomeDir(trimquotes.TryTrimQuotes(identityAgentRaw))
		if err != nil {
			return nil, err
		}
		sshKeywords.SshIdentityAgent = utilfn.Ptr(agentPath)
	}

	proxyJumpRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "ProxyJump")
	if err != nil {
		return nil, err
	}
	proxyJumpSplit := strings.Split(proxyJumpRaw, ",")
	for _, proxyJumpName := range proxyJumpSplit {
		proxyJumpName = strings.TrimSpace(proxyJumpName)
		if proxyJumpName == "" || strings.ToLower(proxyJumpName) == "none" {
			continue
		}
		sshKeywords.SshProxyJump = append(sshKeywords.SshProxyJump, proxyJumpName)
	}
	rawUserKnownHostsFile, _ := WaveSshConfigUserSettings().GetStrict(hostPattern, "UserKnownHostsFile")
	sshKeywords.SshUserKnownHostsFile = strings.Fields(rawUserKnownHostsFile) // TODO - smarter splitting escaped spaces and quotes
	rawGlobalKnownHostsFile, _ := WaveSshConfigUserSettings().GetStrict(hostPattern, "GlobalKnownHostsFile")
	sshKeywords.SshGlobalKnownHostsFile = strings.Fields(rawGlobalKnownHostsFile) // TODO - smarter splitting escaped spaces and quotes

	return sshKeywords, nil
}

func findSshDefaults(hostPattern string) (connKeywords *wconfig.ConnKeywords, outErr error) {
	sshKeywords := &wconfig.ConnKeywords{}

	userDetails, err := user.Current()
	if err != nil {
		return nil, err
	}
	sshKeywords.SshUser = &userDetails.Username
	sshKeywords.SshHostName = &hostPattern
	sshKeywords.SshPort = utilfn.Ptr(ssh_config.Default("Port"))
	sshKeywords.SshIdentityFile = ssh_config.DefaultAll("IdentityFile", hostPattern, ssh_config.DefaultUserSettings) // use the sshconfig here. should be different later
	sshKeywords.SshBatchMode = utilfn.Ptr(false)
	sshKeywords.SshPubkeyAuthentication = utilfn.Ptr(true)
	sshKeywords.SshPasswordAuthentication = utilfn.Ptr(true)
	sshKeywords.SshKbdInteractiveAuthentication = utilfn.Ptr(true)
	sshKeywords.SshPreferredAuthentications = strings.Split(ssh_config.Default("PreferredAuthentications"), ",")
	sshKeywords.SshAddKeysToAgent = utilfn.Ptr(false)
	sshKeywords.SshIdentitiesOnly = utilfn.Ptr(false)
	sshKeywords.SshIdentityAgent = utilfn.Ptr(ssh_config.Default("IdentityAgent"))
	sshKeywords.SshProxyJump = []string{}
	sshKeywords.SshUserKnownHostsFile = strings.Fields(ssh_config.Default("UserKnownHostsFile"))
	sshKeywords.SshGlobalKnownHostsFile = strings.Fields(ssh_config.Default("GlobalKnownHostsFile"))
	return sshKeywords, nil
}

type SSHOpts struct {
	SSHHost string `json:"sshhost"`
	SSHUser string `json:"sshuser"`
	SSHPort string `json:"sshport,omitempty"`
}

func (opts SSHOpts) String() string {
	stringRepr := ""
	if opts.SSHUser != "" {
		stringRepr = opts.SSHUser + "@"
	}
	stringRepr = stringRepr + opts.SSHHost
	if opts.SSHPort != "22" && opts.SSHPort != "" {
		stringRepr = stringRepr + ":" + fmt.Sprint(opts.SSHPort)
	}
	return stringRepr
}

func mergeKeywords(oldKeywords *wconfig.ConnKeywords, newKeywords *wconfig.ConnKeywords) *wconfig.ConnKeywords {
	if oldKeywords == nil {
		oldKeywords = &wconfig.ConnKeywords{}
	}
	if newKeywords == nil {
		return oldKeywords
	}
	outKeywords := *oldKeywords

	if newKeywords.SshHostName != nil {
		outKeywords.SshHostName = newKeywords.SshHostName
	}
	if newKeywords.SshUser != nil {
		outKeywords.SshUser = newKeywords.SshUser
	}
	if newKeywords.SshPort != nil {
		outKeywords.SshPort = newKeywords.SshPort
	}
	// skip identityfile (handled separately due to different behavior)
	if newKeywords.SshBatchMode != nil {
		outKeywords.SshBatchMode = newKeywords.SshBatchMode
	}
	if newKeywords.SshPubkeyAuthentication != nil {
		outKeywords.SshPubkeyAuthentication = newKeywords.SshPubkeyAuthentication
	}
	if newKeywords.SshPasswordAuthentication != nil {
		outKeywords.SshPasswordAuthentication = newKeywords.SshPasswordAuthentication
	}
	if newKeywords.SshKbdInteractiveAuthentication != nil {
		outKeywords.SshKbdInteractiveAuthentication = newKeywords.SshKbdInteractiveAuthentication
	}
	if newKeywords.SshPreferredAuthentications != nil {
		outKeywords.SshPreferredAuthentications = newKeywords.SshPreferredAuthentications
	}
	if newKeywords.SshAddKeysToAgent != nil {
		outKeywords.SshAddKeysToAgent = newKeywords.SshAddKeysToAgent
	}
	if newKeywords.SshIdentityAgent != nil {
		outKeywords.SshIdentityAgent = newKeywords.SshIdentityAgent
	}
	if newKeywords.SshIdentitiesOnly != nil {
		outKeywords.SshIdentitiesOnly = newKeywords.SshIdentitiesOnly
	}
	if newKeywords.SshProxyJump != nil {
		outKeywords.SshProxyJump = newKeywords.SshProxyJump
	}
	if newKeywords.SshUserKnownHostsFile != nil {
		outKeywords.SshUserKnownHostsFile = newKeywords.SshUserKnownHostsFile
	}
	if newKeywords.SshGlobalKnownHostsFile != nil {
		outKeywords.SshGlobalKnownHostsFile = newKeywords.SshGlobalKnownHostsFile
	}
	if newKeywords.SshPasswordSecretName != nil {
		outKeywords.SshPasswordSecretName = newKeywords.SshPasswordSecretName
	}

	return &outKeywords
}
