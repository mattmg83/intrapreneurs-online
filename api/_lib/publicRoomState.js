export function toPublicRoomState(room) {
  if (!room || typeof room !== 'object') {
    return room;
  }

  const publicSeats = room?.seats && typeof room.seats === 'object'
    ? Object.fromEntries(
        Object.entries(room.seats).map(([seat, seatState]) => {
          const { token, tokenHash, ...restSeatState } = seatState ?? {};
          return [seat, restSeatState];
        }),
      )
    : room.seats;

  const { dealQueue, ...rest } = room;

  return {
    ...rest,
    seats: publicSeats,
  };
}
