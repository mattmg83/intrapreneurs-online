const SEAT_ORDER = ['A', 'B', 'C', 'D'];

function seatSort(a, b) {
  const aIndex = SEAT_ORDER.indexOf(a);
  const bIndex = SEAT_ORDER.indexOf(b);

  if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

export function getJoinedSeatOrder(seats = {}) {
  const entries = Object.entries(seats);
  const connectedSeats = entries
    .filter(([, value]) => Boolean(value?.connected))
    .map(([seat]) => seat)
    .sort(seatSort);

  if (connectedSeats.length > 0) {
    return connectedSeats;
  }

  return entries.map(([seat]) => seat).sort(seatSort);
}

function getNextSeat(joinedSeats, currentSeat) {
  if (joinedSeats.length === 0) {
    throw new Error('No joined seats available.');
  }

  const currentIndex = joinedSeats.indexOf(currentSeat);
  if (currentIndex === -1) {
    return joinedSeats[0];
  }

  return joinedSeats[(currentIndex + 1) % joinedSeats.length];
}

export function reduceRoomState(room, action) {
  if (!action?.type) {
    throw new Error('Missing action type.');
  }

  switch (action.type) {
    case 'END_TURN': {
      const joinedSeats = getJoinedSeatOrder(room.seats ?? {});
      const nextSeat = getNextSeat(joinedSeats, room.currentSeat);

      return {
        ...room,
        currentSeat: nextSeat,
        version: Number(room.version ?? 0) + 1,
      };
    }
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}
