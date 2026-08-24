package config

import (
	"strings"
	"testing"
)

func TestSMSConfigValidateDev(t *testing.T) {
	if err := (SMSConfig{Provider: "dev"}).validate("123456", "test"); err != nil {
		t.Fatalf("测试短信配置应当有效：%v", err)
	}
	if err := (SMSConfig{Provider: "dev"}).validate("", "test"); err == nil {
		t.Fatal("测试短信配置缺少固定验证码时应当失败")
	}
	if err := (SMSConfig{Provider: "dev"}).validate("1234", "test"); err == nil {
		t.Fatal("测试短信配置使用非 6 位验证码时应当失败")
	}
	if err := (SMSConfig{Provider: "dev"}).validate("123456", "production"); err == nil {
		t.Fatal("生产环境不得启用测试短信配置")
	}
}

func TestSMSConfigValidateAliyun(t *testing.T) {
	valid := SMSConfig{
		Provider:        "aliyun",
		Endpoint:        "dysmsapi.aliyuncs.com",
		AccessKeyID:     "key-id",
		AccessKeySecret: "key-secret",
		SignName:        "签名",
		TemplateCode:    "SMS_123",
	}
	if err := valid.validate("", "production"); err != nil {
		t.Fatalf("完整的阿里云短信配置应当有效：%v", err)
	}
	if err := valid.validate("123456", "production"); err == nil {
		t.Fatal("阿里云短信配置不得同时启用固定验证码")
	}
	if err := valid.validate("", "test"); err == nil {
		t.Fatal("测试环境不得启用真实短信配置")
	}

	invalid := valid
	invalid.SignName = ""
	err := invalid.validate("", "production")
	if err == nil || !strings.Contains(err.Error(), "STEWARD_ALIYUN_SMS_SIGN_NAME") {
		t.Fatalf("缺少签名时应返回对应配置名，实际为：%v", err)
	}
}

func TestSMSConfigValidateUnknownProvider(t *testing.T) {
	if err := (SMSConfig{Provider: "unknown"}).validate("", "development"); err == nil {
		t.Fatal("未知短信 Provider 应当失败")
	}
}
