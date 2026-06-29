create or replace function public.submit_answer(
  p_player_id uuid,
  p_client_id uuid,
  p_answer text,
  p_time_left int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_player public.players%rowtype;
  v_room public.rooms%rowtype;
  v_total_players integer;
  v_answered_players integer;
  v_next_question_index integer;
  v_advanced boolean := false;
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

  update public.players
     set has_answered_current_question = true
   where id = p_player_id;

  select count(*) into v_total_players
    from public.players
   where room_id = v_room.id;

  select count(*) into v_answered_players
    from public.players
   where room_id = v_room.id
     and has_answered_current_question = true;

  if v_total_players > 0 and v_answered_players >= v_total_players then
    v_next_question_index := v_room.current_question_index + 1;

    if v_next_question_index >= v_room.total_questions then
      update public.rooms
         set status = 'finished',
             current_question_index = v_room.total_questions
       where id = v_room.id;
    else
      update public.players
         set has_answered_current_question = false
       where room_id = v_room.id;

      update public.rooms
         set current_question_index = v_next_question_index,
             question_started_at = now(),
             question_time = coalesce(v_room.question_time, 30),
             status = 'playing'
       where id = v_room.id;
    end if;
  end if;

  select *
    into v_room
    from public.rooms
   where id = v_player.room_id;

  return jsonb_build_object(
    'room_id', v_room.id,
    'current_question_index', v_room.current_question_index,
    'status', v_room.status,
    'advanced', v_room.current_question_index > v_room.current_question_index,
    'all_answered', v_total_players > 0 and v_answered_players >= v_total_players,
    'answered_players', v_answered_players,
    'total_players', v_total_players
  );
end;
$$;
