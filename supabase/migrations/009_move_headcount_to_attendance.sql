-- 보조강사/경로당 수업의 참석 인원(status 앞자리의 1~2자리 숫자)을 attendance 컬럼으로 이동
DO $$
DECLARE
  r RECORD;
  raw_parts TEXT[];
  first_part TEXT;
  rest_status TEXT;
  new_attendance TEXT;
BEGIN
  FOR r IN
    SELECT id, student, location, status, attendance
    FROM public.daily_logs
    WHERE COALESCE(status, '') <> ''
      AND (
        COALESCE(student, '') LIKE '%보조강사%'
        OR COALESCE(student, '') LIKE '%경로당%'
        OR COALESCE(location, '') LIKE '%경로당%'
      )
  LOOP
    raw_parts := string_to_array(r.status, ',');
    IF COALESCE(array_length(raw_parts, 1), 0) = 0 THEN
      CONTINUE;
    END IF;

    first_part := btrim(raw_parts[1]);
    IF first_part ~ '^\d{1,2}$' THEN
      -- 이미 attendance에 같은 숫자가 맨 앞에 들어가 있지 않은 경우만 이동
      IF COALESCE(r.attendance, '') = '' THEN
        new_attendance := first_part;
      ELSIF btrim(split_part(r.attendance, ',', 1)) <> first_part THEN
        new_attendance := first_part || ', ' || btrim(r.attendance);
      ELSE
        new_attendance := r.attendance;
      END IF;

      IF array_length(raw_parts, 1) > 1 THEN
        rest_status := btrim(array_to_string(raw_parts[2:array_length(raw_parts, 1)], ','));
      ELSE
        rest_status := '';
      END IF;

      UPDATE public.daily_logs
      SET
        attendance = new_attendance,
        status = rest_status
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
