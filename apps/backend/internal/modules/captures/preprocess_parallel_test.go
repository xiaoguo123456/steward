package captures

import (
	"context"
	"sync/atomic"
	"testing"
)

func TestParallelPartsBoundAndJoin(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	started := make(chan struct{}, 10)
	release := make(chan struct{})
	done := make(chan struct{})
	var active, maxActive atomic.Int32
	results := make([]int, 10)
	go func() {
		parallelParts(ctx, len(results), 2, func(i int) {
			n := active.Add(1)
			for old := maxActive.Load(); n > old && !maxActive.CompareAndSwap(old, n); old = maxActive.Load() {
			}
			started <- struct{}{}
			<-release
			results[i] = i + 1
			active.Add(-1)
		})
		close(done)
	}()
	<-started
	<-started
	if active.Load() != 2 {
		t.Fatal("没有并行处理两个独立输入")
	}
	cancel()
	close(release)
	<-done
	if maxActive.Load() != 2 || active.Load() != 0 {
		t.Fatal("并发上限或等待退出失效")
	}
	for i, value := range results {
		if value != 0 && value != i+1 {
			t.Fatal("结果顺序被打乱")
		}
	}
}
