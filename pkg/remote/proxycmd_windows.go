// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package remote

import "os/exec"

func configureProxyCmdSysProcAttr(cmd *exec.Cmd) {
}

func killProxyCmdProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}
