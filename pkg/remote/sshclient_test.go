// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
	xknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

func generateTestSSHPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ed25519 key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("failed to convert to ssh.PublicKey: %v", err)
	}
	return sshPub
}

func TestSplitProxyCommandArgs(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    []string
		wantErr bool
	}{
		{
			name:  "simple args",
			input: "nc -X connect -x proxy.example.com:8080 %h %p",
			want:  []string{"nc", "-X", "connect", "-x", "proxy.example.com:8080", "%h", "%p"},
		},
		{
			name:  "double quoted path with spaces",
			input: `"C:\Program Files\cloudflared\cloudflared.exe" access ssh --hostname %h`,
			want:  []string{`C:\Program Files\cloudflared\cloudflared.exe`, "access", "ssh", "--hostname", "%h"},
		},
		{
			name:  "single quoted argument",
			input: `ssh -W '%h:%p' bastion`,
			want:  []string{"ssh", "-W", "%h:%p", "bastion"},
		},
		{
			name:    "unterminated double quote",
			input:   `nc "unclosed`,
			wantErr: true,
		},
		{
			name:    "unterminated single quote",
			input:   `nc 'unclosed`,
			wantErr: true,
		},
		{
			name:    "empty command",
			input:   "   ",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := splitProxyCommandArgs(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got %v", tc.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestBuildProxyCommandArgsTokenValidation(t *testing.T) {
	t.Run("valid tokens and percent escaping", func(t *testing.T) {
		got, err := buildProxyCommandArgs("ssh -W %h:%p -l %r bastion %%literal", "db.internal.example", "2222", "alice_1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := []string{"ssh", "-W", "db.internal.example:2222", "-l", "alice_1", "bastion", "%literal"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %#v, want %#v", got, want)
		}
	})

	t.Run("rejects shell metacharacters in host", func(t *testing.T) {
		badHosts := []string{
			"example.com;id",
			"example.com|cat",
			"$(whoami).com",
			"host`id`",
			"host name",
			"-oProxyCommand=evil",
			"",
		}
		for _, h := range badHosts {
			if _, err := buildProxyCommandArgs("nc %h %p", h, "22", "alice"); err == nil {
				t.Errorf("expected error for bad host %q, got nil", h)
			}
		}
	})

	t.Run("rejects invalid ports", func(t *testing.T) {
		badPorts := []string{"0", "65536", "-22", "22;id", "abc", "+22", ""}
		for _, p := range badPorts {
			if _, err := buildProxyCommandArgs("nc %h %p", "example.com", p, "alice"); err == nil {
				t.Errorf("expected error for bad port %q, got nil", p)
			}
		}
	})

	t.Run("rejects shell metacharacters and leading dash in user", func(t *testing.T) {
		badUsers := []string{"-root", "alice;id", "alice$(id)", "alice bob", "alice:bob", ""}
		for _, u := range badUsers {
			if _, err := buildProxyCommandArgs("ssh -l %r %h", "example.com", "22", u); err == nil {
				t.Errorf("expected error for bad user %q, got nil", u)
			}
		}
	})

	t.Run("rejects unsupported token", func(t *testing.T) {
		if _, err := buildProxyCommandArgs("nc %h %z", "example.com", "22", "alice"); err == nil {
			t.Errorf("expected error for unsupported token %%z")
		}
	})
}

func TestStrictHostKeyCheckingModes(t *testing.T) {
	ctx := context.Background()
	remoteAddr := &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 22}
	host := "example.test:22"

	key1 := generateTestSSHPublicKey(t)
	key2 := generateTestSSHPublicKey(t)

	t.Run("accept-new auto-accepts unknown host key", func(t *testing.T) {
		tmpDir := t.TempDir()
		khFile := filepath.Join(tmpDir, "known_hosts")
		if err := os.WriteFile(khFile, []byte(""), 0600); err != nil {
			t.Fatalf("write known_hosts: %v", err)
		}
		kw := &wconfig.ConnKeywords{
			SshUserKnownHostsFile: []string{khFile},
		}
		cb, _, err := createHostKeyCallback(ctx, kw, "accept-new")
		if err != nil {
			t.Fatalf("createHostKeyCallback: %v", err)
		}
		if err := cb(host, remoteAddr, key1); err != nil {
			t.Fatalf("accept-new should accept unknown host key, got: %v", err)
		}
	})

	t.Run("accept-new still hard-fails on changed key (MITM protection)", func(t *testing.T) {
		tmpDir := t.TempDir()
		khFile := filepath.Join(tmpDir, "known_hosts")
		line := xknownhosts.Line([]string{xknownhosts.Normalize(host)}, key1) + "\n"
		if err := os.WriteFile(khFile, []byte(line), 0600); err != nil {
			t.Fatalf("write known_hosts: %v", err)
		}
		kw := &wconfig.ConnKeywords{
			SshUserKnownHostsFile: []string{khFile},
		}
		cb, _, err := createHostKeyCallback(ctx, kw, "accept-new")
		if err != nil {
			t.Fatalf("createHostKeyCallback: %v", err)
		}
		err = cb(host, remoteAddr, key2)
		if err == nil {
			t.Fatal("accept-new MUST reject changed host key")
		}
		if got := utilds.GetErrorCode(err); got != ConnErrCode_HostKeyChanged {
			t.Errorf("error code = %q, want %q (err=%v)", got, ConnErrCode_HostKeyChanged, err)
		}
	})

	t.Run("accept-new still hard-fails on revoked key", func(t *testing.T) {
		tmpDir := t.TempDir()
		khFile := filepath.Join(tmpDir, "known_hosts")
		line := "@revoked " + xknownhosts.Line([]string{xknownhosts.Normalize(host)}, key1) + "\n"
		if err := os.WriteFile(khFile, []byte(line), 0600); err != nil {
			t.Fatalf("write known_hosts: %v", err)
		}
		kw := &wconfig.ConnKeywords{
			SshUserKnownHostsFile: []string{khFile},
		}
		cb, _, err := createHostKeyCallback(ctx, kw, "accept-new")
		if err != nil {
			t.Fatalf("createHostKeyCallback: %v", err)
		}
		err = cb(host, remoteAddr, key1)
		if err == nil {
			t.Fatal("accept-new MUST reject revoked host key")
		}
		if got := utilds.GetErrorCode(err); got != ConnErrCode_HostKeyRevoked {
			t.Errorf("error code = %q, want %q (err=%v)", got, ConnErrCode_HostKeyRevoked, err)
		}
	})

	t.Run("yes rejects unknown host key", func(t *testing.T) {
		tmpDir := t.TempDir()
		khFile := filepath.Join(tmpDir, "known_hosts")
		if err := os.WriteFile(khFile, []byte(""), 0600); err != nil {
			t.Fatalf("write known_hosts: %v", err)
		}
		kw := &wconfig.ConnKeywords{
			SshUserKnownHostsFile: []string{khFile},
		}
		cb, _, err := createHostKeyCallback(ctx, kw, "yes")
		if err != nil {
			t.Fatalf("createHostKeyCallback: %v", err)
		}
		err = cb(host, remoteAddr, key1)
		if err == nil {
			t.Fatal("StrictHostKeyChecking=yes MUST reject unknown host key")
		}
		if got := utilds.GetErrorCode(err); got != ConnErrCode_HostKeyVerify {
			t.Errorf("error code = %q, want %q (err=%v)", got, ConnErrCode_HostKeyVerify, err)
		}
	})

	t.Run("no ignores host key verification", func(t *testing.T) {
		kw := &wconfig.ConnKeywords{}
		cb, _, err := createHostKeyCallback(ctx, kw, "no")
		if err != nil {
			t.Fatalf("createHostKeyCallback: %v", err)
		}
		if err := cb(host, remoteAddr, key1); err != nil {
			t.Fatalf("StrictHostKeyChecking=no should ignore host key, got: %v", err)
		}
	})
}
