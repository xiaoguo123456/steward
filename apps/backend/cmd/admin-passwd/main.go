// Command admin-passwd 生成管理员口令的 Argon2id 散列。
//
// 配置里只放散列，不放明文。这个工具是唯一接触明文的地方，
// 而且**明文只从标准输入读，不走命令行参数**——参数会留在 shell 历史里，
// 也会出现在同机器上任何人都能看到的进程列表里。
//
//	go run ./cmd/admin-passwd
//	（然后输入口令，回车）
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/auth"
)

func main() {
	fmt.Fprintln(os.Stderr, "输入管理员口令（输入内容不会回显到日志，也不会写入任何文件）：")

	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && strings.TrimSpace(line) == "" {
		fmt.Fprintln(os.Stderr, "读取失败：", err)
		os.Exit(1)
	}
	password := strings.TrimRight(line, "\r\n")

	if len(password) < 12 {
		// 后台是全站权限最高的入口，不接受短口令。
		fmt.Fprintln(os.Stderr, "口令至少 12 位。")
		os.Exit(1)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintln(os.Stderr, "生成失败：", err)
		os.Exit(1)
	}

	fmt.Fprintln(os.Stderr, "\n以下仅为 Argon2id 散列，正式管理员应优先通过网页短信验证设密：")
	fmt.Println(hash)
}
