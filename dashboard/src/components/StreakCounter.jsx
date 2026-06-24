export function StreakCounter({ streak, best, total, accuracy }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="card text-center">
        <div className="text-3xl">🔥</div>
        <div className="stat text-2xl mt-1">{streak}</div>
        <div className="label mt-1">Current streak</div>
      </div>
      <div className="card text-center">
        <div className="stat text-2xl mt-8">{best}</div>
        <div className="label mt-1">Best streak</div>
      </div>
      <div className="card text-center">
        <div className="stat text-2xl mt-8">{total}</div>
        <div className="label mt-1">Completed</div>
      </div>
      <div className="card text-center">
        <div className="stat text-2xl mt-8">{(accuracy * 100).toFixed(0)}%</div>
        <div className="label mt-1">Accuracy</div>
      </div>
    </div>
  );
}
