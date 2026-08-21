package aliyun

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	smsclient "github.com/alibabacloud-go/dysmsapi-20170525/v5/client"
	"github.com/alibabacloud-go/tea/dara"
)

type fakeSMSClient struct {
	response *smsclient.SendSmsResponse
	err      error
	request  *smsclient.SendSmsRequest
	runtime  *dara.RuntimeOptions
	calls    int
}

func (f *fakeSMSClient) SendSmsWithOptions(request *smsclient.SendSmsRequest,
	runtime *dara.RuntimeOptions) (*smsclient.SendSmsResponse, error) {
	f.calls++
	f.request = request
	f.runtime = runtime
	return f.response, f.err
}

func testSender(client smsClient) *Sender {
	return &Sender{
		client:       client,
		signName:     "测试签名",
		templateCode: "SMS_123",
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func TestSendCodeSuccess(t *testing.T) {
	client := &fakeSMSClient{response: &smsclient.SendSmsResponse{
		Body: &smsclient.SendSmsResponseBody{
			Code:      stringPointer("OK"),
			RequestId: stringPointer("request-id"),
			BizId:     stringPointer("biz-id"),
		},
	}}
	sender := testSender(client)

	if err := sender.SendCode(context.Background(), "13800138000", "654321", "login"); err != nil {
		t.Fatalf("发送应当成功：%v", err)
	}
	if client.calls != 1 {
		t.Fatalf("期望调用一次，实际调用 %d 次", client.calls)
	}
	if got := stringValue(client.request.PhoneNumbers); got != "13800138000" {
		t.Fatalf("手机号不正确：%s", got)
	}
	if got := stringValue(client.request.TemplateParam); got != `{"code":"654321"}` {
		t.Fatalf("模板参数不正确：%s", got)
	}
	if client.runtime.Autoretry == nil || *client.runtime.Autoretry {
		t.Fatal("短信请求必须关闭自动重试")
	}
	if client.runtime.MaxAttempts == nil || *client.runtime.MaxAttempts != 1 {
		t.Fatal("短信请求最多只能尝试一次")
	}
}

func TestSendCodeProviderFailure(t *testing.T) {
	client := &fakeSMSClient{response: &smsclient.SendSmsResponse{
		Body: &smsclient.SendSmsResponseBody{Code: stringPointer("isv.BUSINESS_LIMIT_CONTROL")},
	}}
	err := testSender(client).SendCode(context.Background(), "13800138000", "654321", "login")
	if err == nil {
		t.Fatal("Provider 拒绝请求时应当失败")
	}
}

func TestSendCodeTransportFailure(t *testing.T) {
	client := &fakeSMSClient{err: errors.New("transport failed")}
	err := testSender(client).SendCode(context.Background(), "13800138000", "654321", "login")
	if err == nil {
		t.Fatal("网络请求失败时应当返回错误")
	}
}

func TestSendCodeCancelledBeforeRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := &fakeSMSClient{}

	err := testSender(client).SendCode(ctx, "13800138000", "654321", "login")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("期望 context.Canceled，实际为：%v", err)
	}
	if client.calls != 0 {
		t.Fatal("已取消的请求不应调用短信 Provider")
	}
}
