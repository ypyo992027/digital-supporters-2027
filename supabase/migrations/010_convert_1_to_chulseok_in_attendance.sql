-- daily_logs 및 daily_logs_backup 테이블의 attendance 컬럼 내 '1'을 버튼 텍스트 그대로 '출석'으로 일괄 변경
-- (단독 '1' 또는 콤마/슬래시/공백으로 구분된 '1'만 변환하며 '10', '12' 등 인원수 두 자리 숫자는 건드리지 않음)

UPDATE public.daily_logs
SET attendance = btrim(
  regexp_replace(
    regexp_replace(attendance, '(^|[,/\s])1($|[,/\s])', '\1출석\2', 'g'),
    '(^|[,/\s])1($|[,/\s])', '\1출석\2', 'g'
  )
)
WHERE attendance ~ '(^|[,/\s])1($|[,/\s])';

-- 혹시 status 컬럼에 단독 '1' 출결 태그가 남아있는 경우에도 함께 정리
UPDATE public.daily_logs
SET
  attendance = CASE
    WHEN COALESCE(attendance, '') = '' THEN '출석'
    ELSE attendance
  END,
  status = btrim(
    regexp_replace(
      regexp_replace(status, '^\s*1\s*(?:,\s*)?', ''),
      '\s*,\s*$', ''
    )
  )
WHERE status ~ '^\s*1(\s*,|$)';

UPDATE public.daily_logs_backup
SET attendance = btrim(
  regexp_replace(
    regexp_replace(attendance, '(^|[,/\s])1($|[,/\s])', '\1출석\2', 'g'),
    '(^|[,/\s])1($|[,/\s])', '\1출석\2', 'g'
  )
)
WHERE attendance ~ '(^|[,/\s])1($|[,/\s])';
