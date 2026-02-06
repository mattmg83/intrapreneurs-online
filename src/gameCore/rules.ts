export const assertItIsPlayersTurn = (
  currentSeat: string,
  actingSeat: string,
): void => {
  if (currentSeat !== actingSeat) {
    throw new Error(`It is not ${actingSeat}'s turn.`);
  }
};

export const nextSeatRotation = (
  occupiedSeats: readonly string[],
  currentSeat: string,
): string => {
  if (occupiedSeats.length === 0) {
    throw new Error('Cannot rotate turn order without any occupied seats.');
  }

  const currentIndex = occupiedSeats.indexOf(currentSeat);

  if (currentIndex === -1) {
    return occupiedSeats[0];
  }

  return occupiedSeats[(currentIndex + 1) % occupiedSeats.length];
};
