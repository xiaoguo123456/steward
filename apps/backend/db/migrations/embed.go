// Package migrations 以 embed 方式携带全部 Goose 向前迁移，
// 使 migrate 入口不依赖运行时的文件系统布局。
package migrations

import "embed"

// FS 是全部迁移 SQL 的只读文件系统。
//
//go:embed *.sql
var FS embed.FS
