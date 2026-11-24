// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wavebase

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func getWindowsSystemSummary(_ context.Context) string {
	details := "Windows"
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err == nil {
		defer k.Close()
		productName, _, err := k.GetStringValue("ProductName")
		if err == nil && productName != "" {
			buildStr, _, buildErr := k.GetStringValue("CurrentBuildNumber")
			if buildErr == nil {
				if buildNum, convErr := strconv.Atoi(strings.TrimSpace(buildStr)); convErr == nil && buildNum >= 22000 {
					productName = strings.Replace(productName, "Windows 10", "Windows 11", 1)
				}
			}
			details = strings.TrimSpace(productName)
		}
	}
	return fmt.Sprintf("%s (%s)", details, runtime.GOARCH)
}
