-- Center-wide editable LaTeX preamble. Keeping this in a separate table avoids
-- changing the stable sqlc shape of math_centers.
CREATE TABLE math_center_latex_settings
(
    math_center_id BIGINT PRIMARY KEY REFERENCES math_centers (id) ON DELETE CASCADE,
    preamble      TEXT        NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
