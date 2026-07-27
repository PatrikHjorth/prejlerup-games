create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  credits integer not null default 1000 check (credits >= 0),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'upcoming' check(status in ('upcoming','open','locked','finished')),
  winner_option_id uuid,
  created_at timestamptz not null default now()
);

create table public.challenge_options (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  label text not null,
  position integer not null default 0
);

alter table public.challenges add constraint challenges_winner_fk foreign key (winner_option_id) references public.challenge_options(id);

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  option_id uuid not null references public.challenge_options(id) on delete cascade,
  stake integer not null check(stake >= 10),
  locked_odds numeric(8,2) not null,
  created_at timestamptz not null default now(),
  unique(player_id,challenge_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','Spiller'));
  return new;
end;$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select is_admin from profiles where id=auth.uid()),false)
$$;

create or replace function public.place_bet(p_challenge_id uuid,p_option_id uuid,p_stake integer,p_odds numeric) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from challenges where id=p_challenge_id and status='open') then raise exception 'Dysten er ikke åben'; end if;
  if not exists(select 1 from challenge_options where id=p_option_id and challenge_id=p_challenge_id) then raise exception 'Ugyldig valgmulighed'; end if;
  update profiles set credits=credits-p_stake where id=auth.uid() and credits>=p_stake;
  if not found then raise exception 'Ikke nok credits'; end if;
  insert into bets(player_id,challenge_id,option_id,stake,locked_odds) values(auth.uid(),p_challenge_id,p_option_id,p_stake,p_odds);
end;$$;

create or replace function public.finish_challenge(p_challenge_id uuid,p_winner_option_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Kun admin'; end if;
  update challenges set status='finished',winner_option_id=p_winner_option_id where id=p_challenge_id and status<>'finished';
  update profiles p set credits=p.credits+round(b.stake*b.locked_odds)::integer from bets b where b.challenge_id=p_challenge_id and b.option_id=p_winner_option_id and b.player_id=p.id;
end;$$;

create or replace function public.admin_add_credits(p_player_id uuid,p_amount integer) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Kun admin'; end if; update profiles set credits=credits+p_amount where id=p_player_id; end;$$;
create or replace function public.admin_delete_player(p_player_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Kun admin'; end if; delete from auth.users where id=p_player_id; end;$$;

alter table profiles enable row level security; alter table challenges enable row level security; alter table challenge_options enable row level security; alter table bets enable row level security; alter table notifications enable row level security;
create policy "profiles visible" on profiles for select to authenticated using(true);
create policy "own profile update" on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "challenges visible" on challenges for select to authenticated using(true);
create policy "options visible" on challenge_options for select to authenticated using(true);
create policy "own bets visible" on bets for select to authenticated using(player_id=auth.uid() or is_admin());
create policy "notifications visible" on notifications for select to authenticated using(true);
create policy "admin challenges" on challenges for all to authenticated using(is_admin()) with check(is_admin());
create policy "admin options" on challenge_options for all to authenticated using(is_admin()) with check(is_admin());
create policy "admin notifications" on notifications for insert to authenticated with check(is_admin());

alter publication supabase_realtime add table challenges,challenge_options,profiles,notifications;
