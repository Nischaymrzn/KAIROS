import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

/**
 * A named curve from the literature, drawn on its own axes. These are reference
 * material, never applied to a prediction, so they are kept visually distinct
 * from the model's own what-if output.
 */
export function ReferenceCurve({ data, xLabel, yLabel, caveat, refY }) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <XAxis dataKey="x" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false}
                 label={{ value: xLabel, position: "insideBottomRight", fill: "#6b7280", fontSize: 10 }} />
          <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          {refY != null && <ReferenceLine y={refY} stroke="#374151" strokeDasharray="4 4" />}
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [v.toFixed(3), yLabel]}
          />
          <Line type="monotone" dataKey="y" stroke="#14b8a6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      {caveat && <p className="text-[11px] text-txt-muted leading-relaxed mt-2">{caveat}</p>}
    </div>
  );
}
