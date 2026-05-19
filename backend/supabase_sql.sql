-- Drop all tables (reverse dependency order to respect foreign keys)
drop table if exists golden_dataset cascade;
drop table if exists qa_pairs       cascade;
drop table if exists highlights     cascade;
drop table if exists documents      cascade;

-- Documents (replaces the local knowledge_base/ .txt files)
create table documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null unique,
  content      text not null,
  file_path    text,                    -- Storage bucket path (optional)
  created_at   timestamptz default now()
);

-- Text highlights: one row per (document, topic, span)
-- NOTE: `topic` is stored lowercase by the backend for case-insensitive matching.
--       Always query with lower(topic) or pass already-lowercased values.
create table highlights (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid references documents(id) on delete cascade,
  topic        text not null,
  span         text not null,
  created_at   timestamptz default now(),
  unique (document_id, topic, span)
);

-- Q&A pairs linked to a highlight
create table qa_pairs (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid references documents(id) on delete cascade,
  highlight_id uuid references highlights(id) on delete cascade,
  question     text not null,
  answer       text not null,
  created_at   timestamptz default now(),
  unique (highlight_id, question)
);

-- Golden dataset (approved ApprovedRecords)
create table golden_dataset (
  id           uuid primary key default gen_random_uuid(),
  query        text not null,
  context      text not null,
  answer       text not null,
  source_doc_id uuid references documents(id) on delete set null,
  approved_at  timestamptz default now()
);

create policy "allow all" on documents      for all using (true) with check (true);
create policy "allow all" on highlights     for all using (true) with check (true);
create policy "allow all" on qa_pairs       for all using (true) with check (true);
create policy "allow all" on golden_dataset for all using (true) with check (true);