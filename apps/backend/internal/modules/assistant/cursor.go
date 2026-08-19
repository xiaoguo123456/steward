package assistant

import (
	"encoding/base64"
	"strconv"
	"strings"
)

// 消息分页用序号游标而不是时间游标。
//
// Thread 内 message_seq 单调递增且唯一，比 (created_at, id) 更直接，
// 也不会因为同一毫秒内写入两条消息而漏页。

func encodeSeqCursor(seq int32) string {
	return base64.RawURLEncoding.EncodeToString([]byte("seq:" + strconv.Itoa(int(seq))))
}

// decodeSeqCursor 解析序号游标。游标不合法时按"从头开始"处理，
// 而不是报错：客户端拿到一个坏游标时，重新加载第一页是更合理的结果。
func decodeSeqCursor(raw *string) *int32 {
	if raw == nil || *raw == "" {
		return nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(*raw)
	if err != nil {
		return nil
	}
	value, ok := strings.CutPrefix(string(decoded), "seq:")
	if !ok {
		return nil
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return nil
	}
	seq := int32(n)
	return &seq
}
