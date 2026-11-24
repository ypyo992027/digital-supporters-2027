-- daily_logs 및 daily_logs_backup 테이블에 출결(attendance) 전용 컬럼 추가 및 기존 데이터 분리 이관
ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS attendance TEXT DEFAULT '';

ALTER TABLE public.daily_logs_backup
  ADD COLUMN IF NOT EXISTS attendance TEXT DEFAULT '';

-- 기존 status 컬럼에 합쳐져 있던 출결 태그(1, 결석, 종료, 선생님휴가)를 attendance 컬럼으로 분리
DO $$
DECLARE
  r RECORD;
  raw_parts TEXT[];
  part TEXT;
  sub_parts TEXT[];
  sp TEXT;
  is_all_tags BOOLEAN;
  is_memo_started BOOLEAN;
  is_headcount_row BOOLEAN;
  tag_parts TEXT[];
  memo_parts TEXT[];
  i INT;
BEGIN
  FOR r IN
    SELECT id, student, location, status
    FROM public.daily_logs
    WHERE COALESCE(status, '') <> ''
      AND COALESCE(attendance, '') = ''
  LOOP
    raw_parts := string_to_array(r.status, ',');
    tag_parts := ARRAY[]::TEXT[];
    memo_parts := ARRAY[]::TEXT[];
    is_memo_started := false;
    is_headcount_row := (
      COALESCE(r.student, '') LIKE '%보조강사%'
      OR COALESCE(r.student, '') LIKE '%경로당%'
      OR COALESCE(r.location, '') LIKE '%경로당%'
    );

    FOR i IN 1 .. COALESCE(array_length(raw_parts, 1), 0) LOOP
      part := btrim(raw_parts[i]);
      IF part = '' THEN
        CONTINUE;
      END IF;

      -- 인원수(앞자리 1~2자리 숫자)는 메모 쪽으로 남기되 출결 태그 파싱을 중단하지 않음
      IF i = 1 AND is_headcount_row AND part ~ '^\d{1,2}$' THEN
        memo_parts := array_append(memo_parts, part);
        CONTINUE;
      END IF;

      IF NOT is_memo_started THEN
        sub_parts := regexp_split_to_array(replace(part, '/', ' '), '\s+');
        is_all_tags := true;
        FOREACH sp IN ARRAY sub_parts LOOP
          IF btrim(sp) <> '' AND NOT (btrim(sp) = ANY (ARRAY['1', '결석', '종료', '선생님휴가'])) THEN
            is_all_tags := false;
            EXIT;
          END IF;
        END LOOP;

        IF is_all_tags THEN
          tag_parts := array_append(tag_parts, part);
        ELSE
          is_memo_started := true;
          memo_parts := array_append(memo_parts, part);
        END IF;
      ELSE
        memo_parts := array_append(memo_parts, part);
      END IF;
    END LOOP;

    IF array_length(tag_parts, 1) > 0 THEN
      UPDATE public.daily_logs
      SET
        attendance = array_to_string(tag_parts, ', '),
        status = array_to_string(memo_parts, ', ')
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
