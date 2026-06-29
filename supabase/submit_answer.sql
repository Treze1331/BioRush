drop function if exists public.advance_question_if_ready(uuid, uuid, int);
drop function if exists public.submit_answer(uuid, uuid, text, int);
drop function if exists public.submit_answer(uuid, uuid, text, int, int);
drop function if exists public.submit_answer(uuid, uuid, text, int, int, boolean);

create or replace function public.submit_answer(
  p_player_id uuid,
  p_client_id uuid,
  p_answer text,
  p_time_left int,
  p_question_index int,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_total_players integer := 0;
  v_answered_players integer := 0;
  v_question_time integer := 30;
  v_time_left integer := 0;
  v_earned_points integer := 0;
  v_is_correct boolean := coalesce(p_is_correct, false);
  v_all_answered boolean := false;
  v_deadline timestamptz;
begin
  select *
    into v_player
    from public.players
   where id = p_player_id
   limit 1;

  if not found then
    raise exception 'player_not_found';
  end if;

  select *
    into v_room
    from public.rooms
   where id = v_player.room_id
   for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if v_player.client_id <> p_client_id then
    raise exception 'invalid_player_client';
  end if;

  if v_room.status <> 'playing' then
    return jsonb_build_object(
      'room_id', v_room.id,
      'status', v_room.status,
      'advanced', false,
      'all_answered', false,
      'answered_players', 0,
      'total_players', 0
    );
  end if;

  if p_question_index is not null and p_question_index <> v_room.current_question_index then
    return jsonb_build_object(
      'room_id', v_room.id,
      'current_question_index', v_room.current_question_index,
      'status', v_room.status,
      'advanced', false,
      'all_answered', false,
      'answered_players', 0,
      'total_players', 0,
      'stale_answer', true
    );
  end if;

  select count(*) into v_total_players
    from public.players
   where room_id = v_room.id;

  if coalesce(v_player.has_answered_current_question, false) then
    select count(*) into v_answered_players
      from public.players
     where room_id = v_room.id
       and has_answered_current_question = true;

    v_all_answered := v_total_players > 0 and v_answered_players >= v_total_players;

    return jsonb_build_object(
      'room_id', v_room.id,
      'current_question_index', v_room.current_question_index,
      'status', v_room.status,
      'advanced', false,
      'all_answered', v_all_answered,
      'answered_players', v_answered_players,
      'total_players', v_total_players,
      'duplicate_answer', true,
      'is_correct', coalesce(v_player.last_points, 0) > 0,
      'earned_points', coalesce(v_player.last_points, 0)
    );
  end if;

  v_question_time := greatest(1, coalesce(v_room.question_time, 30));

  if v_room.question_started_at is not null then
    v_deadline := v_room.question_started_at + make_interval(secs => v_question_time);
    v_time_left := least(v_question_time, greatest(0, ceil(extract(epoch from (v_deadline - now())))::int));
  else
    v_time_left := greatest(0, least(coalesce(p_time_left, 0), v_question_time));
  end if;

  if coalesce(p_answer, '') = '' then
    v_is_correct := false;
  end if;

  v_earned_points := case when v_is_correct then 100 + v_time_left * 5 else 0 end;

  update public.players
     set has_answered_current_question = true,
         last_points = v_earned_points,
         score = coalesce(score, 0) + v_earned_points,
         correct_count = coalesce(correct_count, 0) + case when v_is_correct then 1 else 0 end,
         streak = case when v_is_correct then coalesce(streak, 0) + 1 else 0 end
   where id = p_player_id
   returning * into v_player;

  select count(*) into v_answered_players
    from public.players
   where room_id = v_room.id
     and has_answered_current_question = true;

  v_all_answered := v_total_players > 0 and v_answered_players >= v_total_players;

  return jsonb_build_object(
    'room_id', v_room.id,
    'current_question_index', v_room.current_question_index,
    'status', v_room.status,
    'advanced', false,
    'all_answered', v_all_answered,
    'answered_players', v_answered_players,
    'total_players', v_total_players,
    'is_correct', v_is_correct,
    'earned_points', v_earned_points,
    'time_left', v_time_left
  );
end;
$$;

create or replace function public.submit_answer(
  p_player_id uuid,
  p_client_id uuid,
  p_answer text,
  p_time_left int,
  p_question_index int
)
returns jsonb
language sql
security definer
as $$
  select public.submit_answer(
    p_player_id,
    p_client_id,
    p_answer,
    p_time_left,
    p_question_index,
    false
  );
$$;

create or replace function public.submit_answer(
  p_player_id uuid,
  p_client_id uuid,
  p_answer text,
  p_time_left int
)
returns jsonb
language sql
security definer
as $$
  select public.submit_answer(
    p_player_id,
    p_client_id,
    p_answer,
    p_time_left,
    null,
    false
  );
$$;

create or replace function public.advance_question_if_ready(
  p_room_id uuid,
  p_client_id uuid,
  p_question_index int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_total_players integer := 0;
  v_answered_players integer := 0;
  v_next_question_index integer := 0;
  v_all_answered boolean := false;
begin
  select *
    into v_player
    from public.players
   where room_id = p_room_id
     and client_id = p_client_id
   limit 1;

  if not found then
    raise exception 'invalid_room_client';
  end if;

  select *
    into v_room
    from public.rooms
   where id = p_room_id
   for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if v_room.status <> 'playing' then
    return jsonb_build_object(
      'room_id', v_room.id,
      'current_question_index', v_room.current_question_index,
      'status', v_room.status,
      'advanced', false,
      'all_answered', false,
      'answered_players', 0,
      'total_players', 0
    );
  end if;

  if p_question_index is not null and p_question_index <> v_room.current_question_index then
    return jsonb_build_object(
      'room_id', v_room.id,
      'current_question_index', v_room.current_question_index,
      'status', v_room.status,
      'advanced', false,
      'all_answered', false,
      'answered_players', 0,
      'total_players', 0,
      'stale_advance', true
    );
  end if;

  select count(*) into v_total_players
    from public.players
   where room_id = v_room.id;

  select count(*) into v_answered_players
    from public.players
   where room_id = v_room.id
     and has_answered_current_question = true;

  v_all_answered := v_total_players > 0 and v_answered_players >= v_total_players;

  if not v_all_answered then
    return jsonb_build_object(
      'room_id', v_room.id,
      'current_question_index', v_room.current_question_index,
      'status', v_room.status,
      'advanced', false,
      'all_answered', false,
      'answered_players', v_answered_players,
      'total_players', v_total_players
    );
  end if;

  v_next_question_index := v_room.current_question_index + 1;

  if v_next_question_index >= v_room.total_questions then
    update public.rooms
       set status = 'finished',
           current_question_index = v_room.total_questions
     where id = v_room.id
     returning * into v_room;
  else
    update public.players
       set has_answered_current_question = false
     where room_id = v_room.id;

    update public.rooms
       set current_question_index = v_next_question_index,
           question_started_at = now(),
           question_time = coalesce(v_room.question_time, 30),
           status = 'playing'
     where id = v_room.id
     returning * into v_room;
  end if;

  return jsonb_build_object(
    'room_id', v_room.id,
    'current_question_index', v_room.current_question_index,
    'question_started_at', v_room.question_started_at,
    'question_time', v_room.question_time,
    'status', v_room.status,
    'advanced', true,
    'all_answered', true,
    'answered_players', v_answered_players,
    'total_players', v_total_players
  );
end;
$$;
