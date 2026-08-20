package assistant

import "testing"

// 「没检索到」有两种，只有一种算失败。
//
// 这个区分决定了 CLAUDE.md 里那条「失败率超过一成就上向量检索」的门槛
// 是否可信：把「用户本来就没有记忆」算成失败，一批新用户就能把指标顶满，
// 于是永远看起来该上向量检索。
func TestMemoryRetrievalMissedOnlyCountsRealFailures(t *testing.T) {
	cases := []struct {
		name  string
		stats MemoryRetrievalStats
		want  bool
	}{
		{"没有任何记忆", MemoryRetrievalStats{Hits: 0, Available: 0}, false},
		{"有记忆但没命中", MemoryRetrievalStats{Hits: 0, Available: 5}, true},
		{"命中了", MemoryRetrievalStats{Hits: 2, Available: 5}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.stats.Missed(); got != tc.want {
				t.Errorf("期望 Missed()=%v，实际 %v", tc.want, got)
			}
		})
	}
}
