// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wavebase

import (
	"context"
	"fmt"
	"runtime"
)

func getWindowsSystemSummary(_ context.Context) string {
	return fmt.Sprintf("Windows (%s)", runtime.GOARCH)
}
