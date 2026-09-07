package ai

import "unicode"

// HasVisibleText 仅用于判空，不删除有效正文中的连接符或表情序列。
func HasVisibleText(text string) bool {
	for _, r := range text {
		if !unicode.IsSpace(r) && !unicode.Is(unicode.Cf, r) && !unicode.IsControl(r) {
			return true
		}
	}
	return false
}
