export async function sleepRandom(
  min: number,
  max: number
): Promise<void> {
  const ms = Math.random() * (max - min) + min;
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}