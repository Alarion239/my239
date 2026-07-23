-- Likbez is a center-wide lecture catalog. Unlike homework series, its
-- numbering is continuous for the whole center while term_id is only a
-- historical label (academic year, camp, or imported legacy archive).
CREATE TABLE math_center_likbez
(
    id             BIGSERIAL PRIMARY KEY,
    math_center_id BIGINT      NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    term_id        BIGINT      NOT NULL,
    number         INTEGER     NOT NULL CHECK (number > 0),
    title          TEXT        NOT NULL,
    held_on        DATE        NOT NULL,
    description    TEXT        NOT NULL,
    pdf_object_key TEXT,
    tex_source     TEXT,
    video_url      TEXT,
    published_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_math_center_likbez_term_center
        FOREIGN KEY (term_id, math_center_id)
            REFERENCES math_center_terms (id, math_center_id)
            ON DELETE CASCADE,
    CONSTRAINT uq_math_center_likbez_number UNIQUE (math_center_id, number)
);

CREATE INDEX idx_math_center_likbez_catalog
    ON math_center_likbez (math_center_id, number DESC);
