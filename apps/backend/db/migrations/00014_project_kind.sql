-- +goose Up
-- 项目用途。
--
-- trip 的项目在移动端用行程界面展示，底下仍然是同一个 Project
-- 加它关联的 Event、Task 与 Note，不创建 Trip 对象。
ALTER TABLE projects ADD COLUMN project_kind text NOT NULL DEFAULT 'general';

ALTER TABLE projects ADD CONSTRAINT projects_project_kind_check
    CHECK (project_kind IN ('general', 'trip'));

-- +goose Down
ALTER TABLE projects DROP CONSTRAINT projects_project_kind_check;
ALTER TABLE projects DROP COLUMN project_kind;
