package redisstream

import "testing"

func TestChannelIncludesEnvironmentNamespace(t *testing.T) {
	t.Parallel()

	transport := &Transport{namespace: "steward-test"}
	if got, want := transport.channelFor("01HXYZ"), "steward-test:turn_01HXYZ"; got != want {
		t.Fatalf("Redis 通道 = %q，期望 %q", got, want)
	}
}
