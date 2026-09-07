package timeutil

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var monthDayExpression = regexp.MustCompile(`^(?:(\d{4})年)?([0-9一二三四五六七八九十两]+)月([0-9一二三四五六七八九十两]+)[日号]?$`)
var clockExpression = regexp.MustCompile(`^(凌晨|早上|上午|中午|下午|晚上)?([0-9零一二三四五六七八九十两]+)(?:点|:|：)(半|[0-9零一二三四五六七八九十两]+分?)?$`)

// ResolveDateExpression 只支持可以唯一求值的日期，不把模糊日期顺延或猜成某一天。
func ResolveDateExpression(expression string, now time.Time, loc *time.Location) (time.Time, error) {
	expression = strings.TrimSpace(expression)
	today := DateOf(now, loc)
	offsets := map[string]int{"今天": 0, "明天": 1, "后天": 2, "大后天": 3}
	if offset, ok := offsets[expression]; ok {
		return today.AddDate(0, 0, offset), nil
	}
	if value, err := ParseDate(expression, loc); err == nil {
		return value, nil
	}
	if match := monthDayExpression.FindStringSubmatch(expression); match != nil {
		year := today.Year()
		if match[1] != "" {
			year, _ = strconv.Atoi(match[1])
		}
		month, day := chineseNumber(match[2]), chineseNumber(match[3])
		if month < 1 || month > 12 || day < 1 || day > 31 {
			return time.Time{}, fmt.Errorf("日期不存在")
		}
		value := time.Date(year, time.Month(month), day, 0, 0, 0, 0, loc)
		if int(value.Month()) != month || value.Day() != day {
			return time.Time{}, fmt.Errorf("日期不存在")
		}
		// 未给年份且本年已过去的月日并不唯一，不猜明年。
		if match[1] == "" && value.Before(today) {
			return time.Time{}, fmt.Errorf("请补充年份")
		}
		return value, nil
	}
	for _, prefix := range []string{"本周", "这周", "下周", "下星期", "星期", "周"} {
		if !strings.HasPrefix(expression, prefix) {
			continue
		}
		days := map[string]int{"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}
		if day, ok := days[strings.TrimPrefix(expression, prefix)]; ok {
			monday := today.AddDate(0, 0, -(int(today.Weekday())+6)%7)
			if strings.HasPrefix(prefix, "下") {
				monday = monday.AddDate(0, 0, 7)
			}
			value := monday.AddDate(0, 0, day)
			if value.Before(today) && (prefix == "周" || prefix == "星期") {
				return time.Time{}, fmt.Errorf("请说明哪一周")
			}
			return value, nil
		}
	}
	return time.Time{}, fmt.Errorf("日期尚不明确")
}

// ResolveClockExpression 不为“下午”补出小时；12 小时制需要明确上午或下午。
func ResolveClockExpression(expression, period string, date time.Time) (time.Time, error) {
	expression = strings.TrimSpace(expression)
	match := clockExpression.FindStringSubmatch(expression)
	if match == nil {
		return time.Time{}, fmt.Errorf("请补充具体时刻")
	}
	if match[1] != "" {
		period = match[1]
	}
	hour := chineseNumber(match[2])
	minute := 0
	if match[3] == "半" {
		minute = 30
	} else if match[3] != "" {
		minute = chineseNumber(strings.TrimSuffix(match[3], "分"))
	}
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return time.Time{}, fmt.Errorf("时刻不存在")
	}
	if period == "" && hour > 0 && hour < 12 && !strings.ContainsAny(expression, ":：") {
		return time.Time{}, fmt.Errorf("请说明上午还是下午")
	}
	if period == "下午" || period == "晚上" || period == "中午" {
		if hour < 12 {
			hour += 12
		}
	} else if period == "凌晨" && hour == 12 {
		hour = 0
	}
	result := time.Date(date.Year(), date.Month(), date.Day(), hour, minute, 0, 0, date.Location())
	if result.Hour() != hour || result.Minute() != minute {
		return time.Time{}, fmt.Errorf("该时区的时刻不存在")
	}
	return result, nil
}

func chineseNumber(value string) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	digits := map[rune]int{'零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	n, current := 0, 0
	for _, r := range value {
		if r == '十' {
			if current == 0 {
				current = 1
			}
			n += current * 10
			current = 0
		} else if digit, ok := digits[r]; ok {
			current = digit
		} else {
			return -1
		}
	}
	return n + current
}
