alter table listings
  add column if not exists photos_confirmed boolean not null default false;
