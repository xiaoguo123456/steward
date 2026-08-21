// Package aliyun 实现阿里云短信验证码发送适配器。
package aliyun

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	openapiutil "github.com/alibabacloud-go/darabonba-openapi/v2/utils"
	smsclient "github.com/alibabacloud-go/dysmsapi-20170525/v5/client"
	"github.com/alibabacloud-go/tea/dara"
)

const (
	connectTimeoutMilliseconds = 5_000
	readTimeoutMilliseconds    = 10_000
)

// Config 保存创建阿里云短信客户端所需的配置。
type Config struct {
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	SignName        string
	TemplateCode    string
}

type smsClient interface {
	SendSmsWithOptions(request *smsclient.SendSmsRequest, runtime *dara.RuntimeOptions) (*smsclient.SendSmsResponse, error)
}

// Sender 发送阿里云验证码短信。
type Sender struct {
	client       smsClient
	signName     string
	templateCode string
	logger       *slog.Logger
}

// New 创建可并发复用的阿里云短信发送器。
func New(cfg Config, logger *slog.Logger) (*Sender, error) {
	if cfg.Endpoint == "" || cfg.AccessKeyID == "" || cfg.AccessKeySecret == "" ||
		cfg.SignName == "" || cfg.TemplateCode == "" {
		return nil, errors.New("阿里云短信配置不完整")
	}

	client, err := smsclient.NewClient((&openapiutil.Config{}).
		SetAccessKeyId(cfg.AccessKeyID).
		SetAccessKeySecret(cfg.AccessKeySecret).
		SetEndpoint(cfg.Endpoint))
	if err != nil {
		return nil, fmt.Errorf("创建阿里云短信客户端失败：%w", err)
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Sender{
		client:       client,
		signName:     cfg.SignName,
		templateCode: cfg.TemplateCode,
		logger:       logger,
	}, nil
}

// SendCode 发送一条验证码短信。
//
// SendSms 会产生费用且不具备幂等性，因此这里显式关闭 SDK 自动重试。
func (s *Sender) SendCode(ctx context.Context, phone, code, purpose string) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("短信请求已取消：%w", err)
	}

	templateParam, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return errors.New("生成短信模板参数失败")
	}
	request := &smsclient.SendSmsRequest{
		PhoneNumbers:  stringPointer(phone),
		SignName:      stringPointer(s.signName),
		TemplateCode:  stringPointer(s.templateCode),
		TemplateParam: stringPointer(string(templateParam)),
	}
	runtime := (&dara.RuntimeOptions{}).
		SetAutoretry(false).
		SetMaxAttempts(1).
		SetConnectTimeout(connectTimeoutMilliseconds).
		SetReadTimeout(readTimeoutMilliseconds)

	response, err := s.client.SendSmsWithOptions(request, runtime)
	if err != nil {
		// SDK 错误可能携带完整请求；日志和上层错误都只保留类型，不记录手机号或验证码。
		s.logger.Warn("阿里云短信请求失败", "purpose", purpose, "error_type", fmt.Sprintf("%T", err))
		return errors.New("阿里云短信请求失败")
	}
	if response == nil || response.Body == nil {
		s.logger.Warn("阿里云短信返回空响应", "purpose", purpose)
		return errors.New("阿里云短信返回空响应")
	}

	providerCode := stringValue(response.Body.Code)
	if providerCode != "OK" {
		s.logger.Warn("阿里云短信发送未受理",
			"purpose", purpose,
			"provider_code", providerCode,
			"request_id", stringValue(response.Body.RequestId))
		return fmt.Errorf("阿里云短信发送未受理，状态码 %s", providerCode)
	}

	s.logger.Info("阿里云短信发送已受理",
		"purpose", purpose,
		"request_id", stringValue(response.Body.RequestId),
		"biz_id", stringValue(response.Body.BizId))
	return nil
}

func stringPointer(value string) *string { return &value }

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
