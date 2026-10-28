ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;

CREATE POLICY "Student_center_isolation"
ON "Student"
FOR ALL
USING (
    "centerId"::text = NULLIF(current_setting('app.current_center', true), '')
)
WITH CHECK (
    "centerId"::text = NULLIF(current_setting('app.current_center', true), '')
);
