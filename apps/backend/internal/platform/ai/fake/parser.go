// Package fake 提供确定性的本地 Capture 解析实现。
//
// 它满足两个目的：
//  1. 没有配置任何模型 Provider 时，Capture 闭环仍然可以完整跑通，
//     开发、测试与离线演示不依赖外部服务。
//  2. 作为 Adapter Contract Test 的基准实现：相同输入必然得到相同输出，
//     可以用来验证下游的校验、确认与写入逻辑，而不受模型波动影响。
//
// 它不是产品级的自然语言理解。真实 Provider 接入后，这里的规则只保留为测试替身。
package fake

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// Parser 是确定性的 Capture 解析器。
type Parser struct{}

// New 构造 Parser。
func New() *Parser { return &Parser{} }

// Name 返回 Provider 名称。
func (p *Parser) Name() string { return "fake" }

// ParseCapture 把输入文字拆成候选对象。
func (p *Parser) ParseCapture(_ context.Context, req ai.CaptureParseRequest) (ai.CaptureParseResult, error) {
	started := time.Now()
	loc := timeutil.LoadLocation(req.Timezone)

	var result ai.CaptureParseResult
	result.ProviderModel = "fake-deterministic"
	result.PromptVersion = "fake-v4"
	result.SchemaVersion = "capture-parse-result.v4"

	defaultListID := ""
	for _, l := range req.Lists {
		if l.IsDefault {
			defaultListID = l.ID
			break
		}
	}

	// 先识别整体性的限制说明，例如“只处理第一张”。
	instruction := detectInstruction(req)
	result.InstructionNote = instruction

	segments := collectSegments(req)
	parsedItineraryParts := make(map[string]struct{})
	if req.SuggestedProjectID != "" {
		for _, part := range req.Parts {
			if candidate := parseItineraryPart(part, req.SuggestedProjectID, req.Now, loc); candidate != nil {
				result.Candidates = append(result.Candidates, *candidate)
				parsedItineraryParts[part.ID] = struct{}{}
			}
		}
	}
	if len(segments) == 0 {
		// 没有任何可理解的文字：不猜测内容，而是请用户补充说明。
		result.Questions = append(result.Questions, ai.QuestionDraft{
			Question:     "这次输入里没有可以识别的文字，请补充一句说明要记什么。",
			Blocking:     true,
			QuickAnswers: []string{"记成一条笔记", "这是一个待办"},
			Summary:      "需要补充说明",
		})
		result.Usage = ai.Usage{LatencyMS: int(time.Since(started).Milliseconds())}
		return result, nil
	}

	for _, seg := range segments {
		if _, parsed := parsedItineraryParts[seg.PartID]; parsed {
			continue
		}
		candidate := parseSegment(seg, req.Now, loc, defaultListID, req.Trackers)
		if candidate != nil {
			result.Candidates = append(result.Candidates, *candidate)
		}
	}

	// 多个片段解析出互相冲突的日期时，交给用户选择而不是自行取舍。
	if conflict := detectDateConflict(result.Candidates, segments, loc); conflict != nil {
		result.Conflicts = append(result.Conflicts, *conflict)
	}

	result.Usage = ai.Usage{
		InputTokens:  countRunes(segments),
		OutputTokens: len(result.Candidates) * 20,
		LatencyMS:    int(time.Since(started).Milliseconds()),
	}
	return result, nil
}

var (
	itineraryTransportKeywords = []string{"车票", "火车", "高铁", "动车", "列车", "车次", "航班", "机票", "登机牌", "船票", "客运票"}
	itineraryDatePattern       = regexp.MustCompile(`(?:(\d{4})[年\-/])?(\d{1,2})[月\-/](\d{1,2})日?`)
	itineraryPlaceTimePattern  = regexp.MustCompile(`([\p{Han}A-Za-z·]{2,20}(?:站|机场)?)\s*(\d{1,2}:\d{2})`)
	itineraryServicePattern    = regexp.MustCompile(`(?i)(?:车次|航班号?|班次)?\s*([A-Z]{1,3}\d{1,5})`)
	itinerarySeatPattern       = regexp.MustCompile(`(\d+\s*车\s*\d+[A-Za-z]?\s*(?:座|铺)?|\d+[A-Za-z]\s*(?:座|铺)?)`)
)

// parseItineraryPart 为离线测试与 Provider 降级路径识别常见电子票文本。
// 只抽取票面明确出现的时间、地点和班次，不推测中转、站点或座位。
func parseItineraryPart(part ai.InputPart, projectID string, now time.Time, loc *time.Location) *ai.CandidateDraft {
	text := strings.TrimSpace(part.Text)
	if text == "" || !containsAny(text, itineraryTransportKeywords) {
		return nil
	}
	date := itineraryDate(text, now, loc)
	matches := itineraryPlaceTimePattern.FindAllStringSubmatch(text, -1)
	if len(matches) < 2 {
		return nil
	}

	origin := strings.TrimSpace(matches[0][1])
	destination := strings.TrimSpace(matches[1][1])
	startAt := itineraryTime(date, matches[0][2], loc)
	endAt := itineraryTime(date, matches[1][2], loc)
	if startAt == nil || endAt == nil {
		return nil
	}
	if !endAt.After(*startAt) {
		nextDay := endAt.AddDate(0, 0, 1)
		endAt = &nextDay
	}

	mode := "train"
	if containsAny(text, []string{"航班", "机票", "登机牌"}) {
		mode = "flight"
	} else if containsAny(text, []string{"船票"}) {
		mode = "ship"
	} else if containsAny(text, []string{"客运票"}) {
		mode = "coach"
	}
	serviceNumber := ""
	if match := itineraryServicePattern.FindStringSubmatch(text); len(match) > 1 {
		serviceNumber = strings.ToUpper(strings.TrimSpace(match[1]))
	}
	seat := ""
	if match := itinerarySeatPattern.FindStringSubmatch(text); len(match) > 1 {
		seat = strings.Join(strings.Fields(match[1]), "")
	}

	title := origin + "至" + destination
	if serviceNumber != "" {
		title = serviceNumber + " " + title
	}
	source := ai.SourceSpan{PartID: part.ID, TextStart: 0, TextEnd: len(part.Text)}
	return &ai.CandidateDraft{
		Type:       "event",
		Action:     "create",
		Title:      title,
		EventKind:  "schedule",
		AllDay:     false,
		StartAt:    startAt,
		EndAt:      endAt,
		Location:   origin,
		ProjectRef: projectID,
		ItineraryDetails: &ai.ItineraryDetailsDraft{
			Kind:          "transport",
			TransportMode: mode,
			Origin:        origin,
			Destination:   destination,
			ServiceNumber: serviceNumber,
			Seat:          seat,
			BookingStatus: "ticketed",
		},
		Sources: []ai.SourceSpan{source},
		Confidences: []ai.Confidence{
			{Field: "start_at", Level: "high", Sources: []ai.SourceSpan{source}},
			{Field: "itinerary_details", Level: "medium", Sources: []ai.SourceSpan{source}},
		},
	}
}

func itineraryDate(text string, now time.Time, loc *time.Location) time.Time {
	match := itineraryDatePattern.FindStringSubmatch(text)
	if len(match) == 0 {
		return timeutil.DayOf(now, loc).Date
	}
	year := now.In(loc).Year()
	if match[1] != "" {
		year, _ = strconv.Atoi(match[1])
	}
	month, _ := strconv.Atoi(match[2])
	day, _ := strconv.Atoi(match[3])
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, loc)
}

func itineraryTime(date time.Time, raw string, loc *time.Location) *time.Time {
	parsed, err := time.ParseInLocation("15:04", raw, loc)
	if err != nil {
		return nil
	}
	value := time.Date(date.Year(), date.Month(), date.Day(), parsed.Hour(), parsed.Minute(), 0, 0, loc)
	return &value
}

// segment 是一段待解析的文字及其来源位置。
type segment struct {
	PartID string
	Text   string
	Start  int
	End    int
}

var segmentSplitter = regexp.MustCompile(`[\n\r；;。]+`)

// collectSegments 把全部文字输入拆成语义片段，并保留原始偏移用于来源追溯。
func collectSegments(req ai.CaptureParseRequest) []segment {
	var out []segment
	for _, part := range req.Parts {
		text := strings.TrimSpace(part.Text)
		if text == "" {
			continue
		}
		offset := 0
		for _, piece := range segmentSplitter.Split(part.Text, -1) {
			trimmed := strings.TrimSpace(piece)
			idx := strings.Index(part.Text[offset:], piece)
			start := offset
			if idx >= 0 {
				start = offset + idx
			}
			offset = start + len(piece)
			if trimmed == "" {
				continue
			}
			out = append(out, segment{
				PartID: part.ID,
				Text:   trimmed,
				Start:  start,
				End:    start + len(piece),
			})
		}
	}
	return out
}

var instructionPattern = regexp.MustCompile(`只(处理|识别|看|要)[^，。；\n]*`)

// detectInstruction 提取用户给出的限制条件。
// 这类说明必须在确认页醒目展示，不能被静默忽略。
func detectInstruction(req ai.CaptureParseRequest) string {
	for _, part := range req.Parts {
		if part.Kind != ai.PartText {
			continue
		}
		if m := instructionPattern.FindString(part.Text); m != "" {
			return strings.TrimSpace(m)
		}
	}
	return ""
}

// 关键词表。命中越靠前的类别优先级越高。
var (
	eventKeywords = []string{
		"会议", "开会", "见面", "面试", "培训", "讲座", "聚餐", "体检",
		"航班", "火车", "出发", "拜访", "约了", "约见", "复诊", "看牙",
	}
	importantDateKeywords = []string{"生日", "纪念日", "周年"}
	noteKeywords          = []string{"记一下", "笔记", "想法", "备忘", "灵感", "记下"}
	highPriorityKeywords  = []string{"重要", "紧急", "务必", "尽快", "马上", "抓紧"}
	lowPriorityKeywords   = []string{"有空", "不急", "有时间", "顺便"}
)

// parseSegment 把一个片段解析成候选对象。
func parseSegment(seg segment, now time.Time, loc *time.Location,
	defaultListID string, trackers []ai.TrackerRef) *ai.CandidateDraft {

	text := seg.Text
	source := ai.SourceSpan{PartID: seg.PartID, TextStart: seg.Start, TextEnd: seg.End}
	if looksLikeTrip(text) {
		return parseTripSegment(seg, now, loc)
	}

	// isDeadline 目前只影响时间表达的剥离范围，不改变字段选择：
	// 有明确时刻就用 due_at，只有日期就用 due_date。
	when, whenSpan, hasTime, _ := parseWhen(text, now, loc)
	title := cleanTitle(text, whenSpan)
	if title == "" {
		title = text
	}

	candidate := ai.CandidateDraft{
		Action:  "create",
		Title:   title,
		Sources: []ai.SourceSpan{source},
	}

	// 记录项优先：如果片段里出现了某个 Tracker 的名字和数值，按 Record 处理。
	if rec := matchRecord(text, trackers, now); rec != nil {
		rec.Sources = []ai.SourceSpan{source}
		rec.Confidences = append(rec.Confidences, ai.Confidence{
			Field: "values", Level: "medium", Sources: []ai.SourceSpan{source},
		})
		return rec
	}

	switch {
	case containsAny(text, importantDateKeywords) && when != nil:
		candidate.Type = "event"
		candidate.EventKind = "important_date"
		candidate.AllDay = true
		d := timeutil.DateOf(*when, loc)
		candidate.StartDate = &d

	case containsAny(text, eventKeywords) && when != nil:
		candidate.Type = "event"
		candidate.EventKind = "schedule"
		if hasTime {
			candidate.AllDay = false
			candidate.StartAt = when
		} else {
			// 日期明确、时间不明确时保存为全天事件，并在确认页显式标注。
			candidate.AllDay = true
			d := timeutil.DateOf(*when, loc)
			candidate.StartDate = &d
			candidate.Warnings = append(candidate.Warnings, "没有具体时间，已按全天事件处理。")
		}

	case containsAny(text, noteKeywords) || (when == nil && !looksActionable(text)):
		candidate.Type = "note"
		content := stripNotePrefix(text)
		candidate.Content = content
		candidate.Title = truncateTitle(content)

	default:
		candidate.Type = "task"
		candidate.ListID = defaultListID
		candidate.Priority = detectPriority(text)
		if when != nil {
			if hasTime {
				candidate.DueAt = when
			} else {
				// “明天交”“周五前完成”只生成 due_date，不擅自补成当天 23:59。
				d := timeutil.DateOf(*when, loc)
				candidate.DueDate = &d
			}
		}
	}

	if when != nil {
		field := "due_date"
		if candidate.Type == "event" {
			field = "start_at"
		} else if candidate.DueAt != nil {
			field = "due_at"
		}
		candidate.Confidences = append(candidate.Confidences, ai.Confidence{
			Field:   field,
			Level:   "high",
			Sources: []ai.SourceSpan{{PartID: seg.PartID, TextStart: seg.Start + whenSpan[0], TextEnd: seg.Start + whenSpan[1]}},
		})
	}
	candidate.Confidences = append(candidate.Confidences, ai.Confidence{
		Field: "title", Level: "high", Sources: []ai.SourceSpan{source},
	})
	return &candidate
}

var (
	tripFullRangePattern   = regexp.MustCompile(`(\d{1,2})月(\d{1,2})[日号]?[到至\-—~～]+(\d{1,2})月(\d{1,2})[日号]?`)
	tripSameRangePattern   = regexp.MustCompile(`(\d{1,2})月(\d{1,2})[日号]?[到至\-—~～]+(\d{1,2})[日号]`)
	tripDestinationPattern = regexp.MustCompile(`(去|前往)([\p{Han}A-Za-z0-9·]{1,20})(旅行|旅游|出差|游玩|玩|，|,|。|；|;|$)`)
	tripToPattern          = regexp.MustCompile(`到([\p{Han}A-Za-z0-9·]{1,20})(旅行|旅游|出差|游玩|玩|，|,|。|；|;|$)`)
)

func looksLikeTrip(text string) bool {
	if strings.Contains(text, "创建行程") || strings.Contains(text, "新建行程") {
		return true
	}
	if !containsAny(text, []string{"旅行", "旅游", "出差"}) {
		return false
	}
	return tripDestinationPattern.MatchString(text) || tripToPattern.MatchString(text) ||
		tripFullRangePattern.MatchString(text) || tripSameRangePattern.MatchString(text)
}

// parseTripSegment 为离线与 Provider 降级路径提供最小、确定性的行程抽取。
// 它只处理明确说出的目的地与数字日期范围，不猜景点、交通或住宿。
func parseTripSegment(seg segment, now time.Time, loc *time.Location) *ai.CandidateDraft {
	text := seg.Text
	source := ai.SourceSpan{PartID: seg.PartID, TextStart: seg.Start, TextEnd: seg.End}
	candidate := &ai.CandidateDraft{
		Type:        "project",
		Action:      "create",
		ProjectKind: "trip",
		Sources:     []ai.SourceSpan{source},
	}

	destination, destinationSpan := parseTripDestination(text)
	candidate.Destination = destination
	if destination == "" {
		candidate.Title = "行程"
		candidate.Missing = append(candidate.Missing, "destination")
	} else {
		candidate.Title = destination + "行程"
	}

	start, end, dateSpan := parseTripDateRange(text, now, loc)
	candidate.StartDate = start
	candidate.TargetDate = end
	if start == nil {
		candidate.Missing = append(candidate.Missing, "start_date")
	}
	if end == nil {
		candidate.Missing = append(candidate.Missing, "target_date")
	}

	notes := text
	if dateSpan[1] > dateSpan[0] {
		phrase := text[dateSpan[0]:dateSpan[1]]
		notes = strings.Replace(notes, phrase, "", 1)
	}
	if destinationSpan[1] > destinationSpan[0] {
		phrase := text[destinationSpan[0]:destinationSpan[1]]
		notes = strings.Replace(notes, phrase, "", 1)
	}
	for _, prefix := range []string{"创建行程", "新建行程", "帮我创建行程", "帮我新建行程"} {
		notes = strings.ReplaceAll(notes, prefix, "")
	}
	notes = strings.TrimSpace(strings.Trim(notes, "：:，,。；;、 "))
	candidate.Description = notes
	candidate.Confidences = []ai.Confidence{{
		Field: "title", Level: "high", Sources: []ai.SourceSpan{source},
	}}
	return candidate
}

func parseTripDestination(text string) (string, [2]int) {
	for _, pattern := range []*regexp.Regexp{tripDestinationPattern, tripToPattern} {
		indexes := pattern.FindStringSubmatchIndex(text)
		if indexes == nil {
			continue
		}
		group := 2
		if pattern == tripDestinationPattern {
			group = 4
		}
		value := strings.TrimSpace(text[indexes[group]:indexes[group+1]])
		if value == "" || strings.Contains(value, "日") {
			continue
		}
		return value, [2]int{indexes[0], indexes[1]}
	}
	return "", [2]int{}
}

func parseTripDateRange(text string, now time.Time, loc *time.Location) (*time.Time, *time.Time, [2]int) {
	today := timeutil.DayOf(now, loc).Date
	if match := tripFullRangePattern.FindStringSubmatchIndex(text); match != nil {
		startMonth, _ := strconv.Atoi(text[match[2]:match[3]])
		startDay, _ := strconv.Atoi(text[match[4]:match[5]])
		endMonth, _ := strconv.Atoi(text[match[6]:match[7]])
		endDay, _ := strconv.Atoi(text[match[8]:match[9]])
		start, end := tripDates(today, startMonth, startDay, endMonth, endDay, loc)
		return start, end, [2]int{match[0], match[1]}
	}
	if match := tripSameRangePattern.FindStringSubmatchIndex(text); match != nil {
		month, _ := strconv.Atoi(text[match[2]:match[3]])
		startDay, _ := strconv.Atoi(text[match[4]:match[5]])
		endDay, _ := strconv.Atoi(text[match[6]:match[7]])
		start, end := tripDates(today, month, startDay, month, endDay, loc)
		return start, end, [2]int{match[0], match[1]}
	}
	return nil, nil, [2]int{}
}

func tripDates(today time.Time, startMonth, startDay, endMonth, endDay int, loc *time.Location) (*time.Time, *time.Time) {
	if !validMonthDay(today.Year(), startMonth, startDay, loc) {
		return nil, nil
	}
	year := today.Year()
	start := time.Date(year, time.Month(startMonth), startDay, 0, 0, 0, 0, loc)
	if start.Before(today) {
		year++
		start = time.Date(year, time.Month(startMonth), startDay, 0, 0, 0, 0, loc)
	}
	endYear := year
	end := time.Date(endYear, time.Month(endMonth), endDay, 0, 0, 0, 0, loc)
	if end.Before(start) {
		endYear++
		end = time.Date(endYear, time.Month(endMonth), endDay, 0, 0, 0, 0, loc)
	}
	if !validMonthDay(endYear, endMonth, endDay, loc) {
		return &start, nil
	}
	return &start, &end
}

func validMonthDay(year, month, day int, loc *time.Location) bool {
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return false
	}
	d := time.Date(year, time.Month(month), day, 0, 0, 0, 0, loc)
	return int(d.Month()) == month && d.Day() == day
}

// looksActionable 判断片段是否包含行动意图。
func looksActionable(text string) bool {
	verbs := []string{
		"买", "写", "做", "完成", "提交", "回复", "整理", "准备", "打电话",
		"联系", "预约", "取", "寄", "交", "缴", "续费", "报名", "安排", "检查",
		"处理", "跟进", "确认", "修复", "更新", "发送", "打印", "预订", "还",
	}
	if containsAny(text, verbs) {
		return true
	}
	// “紧急处理”“务必完成”这类明确的优先级表达本身就意味着这是一件要做的事。
	return containsAny(text, highPriorityKeywords) || containsAny(text, lowPriorityKeywords)
}

func detectPriority(text string) string {
	if containsAny(text, highPriorityKeywords) {
		return "high"
	}
	if containsAny(text, lowPriorityKeywords) {
		return "low"
	}
	return "normal"
}

func containsAny(text string, keywords []string) bool {
	for _, k := range keywords {
		if strings.Contains(text, k) {
			return true
		}
	}
	return false
}

var weekdayNames = map[string]time.Weekday{
	"一": time.Monday, "二": time.Tuesday, "三": time.Wednesday,
	"四": time.Thursday, "五": time.Friday, "六": time.Saturday,
	"日": time.Sunday, "天": time.Sunday,
}

var (
	relDayPattern   = regexp.MustCompile(`(大后天|后天|明天|明日|今天|今日)`)
	weekdayPattern  = regexp.MustCompile(`(下|本|这)?(周|星期|礼拜)([一二三四五六日天])`)
	monthDayPattern = regexp.MustCompile(`(\d{1,2})月(\d{1,2})[日号]`)
	clockPattern    = regexp.MustCompile(`(上午|中午|下午|晚上)?\s*(\d{1,2})[:：点](\d{1,2})?(半)?`)
	deadlinePattern = regexp.MustCompile(`前(完成|交|提交|做完|搞定)?`)
)

// parseWhen 从文字中解析时间表达。
//
// 返回值 span 是命中片段在 text 中的字节区间，用于生成字段级来源；
// hasTime 表示是否解析出了具体时刻；isDeadline 表示“……前”这类截止语义。
func parseWhen(text string, now time.Time, loc *time.Location) (when *time.Time, span [2]int, hasTime, isDeadline bool) {
	today := timeutil.DayOf(now, loc).Date
	var date *time.Time
	span = [2]int{0, 0}

	if m := relDayPattern.FindStringSubmatchIndex(text); m != nil {
		word := text[m[2]:m[3]]
		offset := map[string]int{"今天": 0, "今日": 0, "明天": 1, "明日": 1, "后天": 2, "大后天": 3}[word]
		d := today.AddDate(0, 0, offset)
		date = &d
		span = [2]int{m[0], m[1]}
	} else if m := weekdayPattern.FindStringSubmatchIndex(text); m != nil {
		prefix := ""
		if m[2] >= 0 {
			prefix = text[m[2]:m[3]]
		}
		target := weekdayNames[text[m[6]:m[7]]]
		d := nextWeekday(today, target, prefix == "下")
		date = &d
		span = [2]int{m[0], m[1]}
	} else if m := monthDayPattern.FindStringSubmatchIndex(text); m != nil {
		month, _ := strconv.Atoi(text[m[2]:m[3]])
		day, _ := strconv.Atoi(text[m[4]:m[5]])
		if month >= 1 && month <= 12 && day >= 1 && day <= 31 {
			d := time.Date(today.Year(), time.Month(month), day, 0, 0, 0, 0, loc)
			// 已经过去的月日按明年处理，符合“下一个该日期”的直觉。
			if d.Before(today) {
				d = d.AddDate(1, 0, 0)
			}
			date = &d
			span = [2]int{m[0], m[1]}
		}
	}

	if date == nil {
		return nil, span, false, false
	}

	isDeadline = deadlinePattern.MatchString(text)
	// “周五前完成”中的“前”属于时间表达，一并纳入 span，
	// 否则会在标题里残留成“前完成季度报告”。
	if span[1] < len(text) && strings.HasPrefix(text[span[1]:], "前") {
		span[1] += len("前")
	}

	if cm := clockPattern.FindStringSubmatchIndex(text); cm != nil {
		period := ""
		if cm[2] >= 0 {
			period = text[cm[2]:cm[3]]
		}
		hour, _ := strconv.Atoi(text[cm[4]:cm[5]])
		minute := 0
		if cm[6] >= 0 {
			minute, _ = strconv.Atoi(text[cm[6]:cm[7]])
		}
		if cm[8] >= 0 {
			minute = 30
		}
		// 下午与晚上按 12 小时制换算；中午 12 点保持不变。
		if (period == "下午" || period == "晚上") && hour < 12 {
			hour += 12
		}
		if hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 {
			t := time.Date(date.Year(), date.Month(), date.Day(), hour, minute, 0, 0, loc)
			if cm[0] < span[0] {
				span[0] = cm[0]
			}
			if cm[1] > span[1] {
				span[1] = cm[1]
			}
			return &t, span, true, isDeadline
		}
	}

	return date, span, false, isDeadline
}

// nextWeekday 返回指定星期几的日期。
//
// “周三”指本周内尚未到来的周三；若今天就是周三，则指下一个周三。
// “下周三”在今天是周三时应当是 7 天后，而不是 14 天后，
// 因此先算出本周内的偏移，再统一加一周。
func nextWeekday(from time.Time, target time.Weekday, forceNextWeek bool) time.Time {
	diff := (int(target) - int(from.Weekday()) + 7) % 7
	switch {
	case forceNextWeek:
		diff += 7
	case diff == 0:
		diff = 7
	}
	return from.AddDate(0, 0, diff)
}

var numberUnitPattern = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(公斤|千克|kg|斤|元|块|分钟|小时|公里|km|步|次|个)?`)

// matchRecord 在片段中匹配已有 Tracker 的名称与数值。
func matchRecord(text string, trackers []ai.TrackerRef, now time.Time) *ai.CandidateDraft {
	for _, tracker := range trackers {
		if tracker.Name == "" || !strings.Contains(text, tracker.Name) {
			continue
		}
		m := numberUnitPattern.FindStringSubmatch(text)
		if m == nil {
			continue
		}
		value, err := strconv.ParseFloat(m[1], 64)
		if err != nil {
			continue
		}
		// 取第一个数值字段承载解析结果，其余字段留给用户在确认页补充。
		for _, f := range tracker.Fields {
			if f.Type == "text" {
				continue
			}
			ts := now
			return &ai.CandidateDraft{
				Type:      "record",
				Action:    "create",
				Title:     tracker.Name,
				TrackerID: tracker.ID,
				Timestamp: &ts,
				RecordValues: []ai.RecordValueDraft{
					{Key: f.Key, Number: &value},
				},
			}
		}
	}
	return nil
}

// cleanTitle 去掉时间表达后作为标题，避免标题里重复出现“明天下午三点”。
func cleanTitle(text string, span [2]int) string {
	if span[1] <= span[0] || span[1] > len(text) {
		return strings.TrimSpace(text)
	}
	cleaned := text[:span[0]] + text[span[1]:]
	cleaned = strings.TrimSpace(cleaned)
	cleaned = strings.Trim(cleaned, "，,、 ")
	return cleaned
}

// stripNotePrefix 去掉“记一下：”这类引导词，让笔记正文只保留真正的内容。
func stripNotePrefix(text string) string {
	trimmed := strings.TrimSpace(text)
	for _, keyword := range noteKeywords {
		if !strings.HasPrefix(trimmed, keyword) {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(trimmed, keyword))
		rest = strings.TrimLeft(rest, "：: ，,、")
		if rest != "" {
			return strings.TrimSpace(rest)
		}
	}
	return trimmed
}

func truncateTitle(text string) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > 24 {
		return string(runes[:24])
	}
	return string(runes)
}

// detectDateConflict 检测多个候选之间的日期冲突。
func detectDateConflict(candidates []ai.CandidateDraft, segments []segment, loc *time.Location) *ai.ConflictDraft {
	seen := make(map[string][]ai.SourceSpan)
	for i, c := range candidates {
		var d *time.Time
		switch {
		case c.DueDate != nil:
			d = c.DueDate
		case c.DueAt != nil:
			d = c.DueAt
		case c.StartDate != nil:
			d = c.StartDate
		case c.StartAt != nil:
			d = c.StartAt
		}
		if d == nil {
			continue
		}
		key := timeutil.FormatDate(d.In(loc))
		if i < len(segments) {
			seen[key] = append(seen[key], ai.SourceSpan{
				PartID: segments[i].PartID, TextStart: segments[i].Start, TextEnd: segments[i].End,
			})
		}
	}
	if len(seen) < 2 {
		return nil
	}

	// 同一次输入里出现两个以上不同日期时提示用户确认，而不是替他选一个。
	options := make([]ai.ConflictOption, 0, len(seen))
	for value, sources := range seen {
		options = append(options, ai.ConflictOption{Value: value, Sources: sources})
	}
	return &ai.ConflictDraft{
		Field:       "date",
		Description: "这次输入里出现了多个日期，请确认它们分别属于哪一项。",
		Options:     options,
	}
}

func countRunes(segments []segment) int {
	total := 0
	for _, s := range segments {
		total += len([]rune(s.Text))
	}
	return total
}
