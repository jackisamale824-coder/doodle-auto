import type { Point } from "./coast";

type Stop = Point & {
  task: string;
  chase?: boolean;
  onFoot?: boolean;
  losePatrol?: boolean;
};
type Job = { name: string; pay: number; stops: Stop[] };
export const jobs: Job[] = [
  {
    name: "Last call",
    pay: 350,
    stops: [
      { x: 63, z: 54, task: "Collect the film reels on Ocean Strip" },
      { x: 63, z: 1, task: "Deliver the reels to Sunset FM" },
    ],
  },
  {
    name: "Night fare",
    pay: 600,
    stops: [
      { x: 9, z: 2, task: "Pick up the singer on Coral Avenue" },
      { x: -36, z: -48, task: "Drop her at the Marlin Club" },
    ],
  },
  {
    name: "Hot pressing",
    pay: 900,
    stops: [
      {
        x: -88,
        z: -48,
        task: "Step out and collect the missing tape",
        onFoot: true,
      },
      {
        x: 58,
        z: -96,
        task: "Take the tape to the north turnaround",
        chase: true,
      },
      {
        x: 63,
        z: 84,
        task: "Deliver the master to the Lido",
        losePatrol: true,
      },
    ],
  },
];
const key = "sully6.vice-coast.shift.v1";
export function completedJobs() {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isInteger(value) && value >= 0 && value <= jobs.length
      ? value
      : 0;
  } catch {
    return 0;
  }
}
export function saveJobs(count: number) {
  try {
    localStorage.setItem(key, String(count));
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
}
export function earnings(count: number) {
  return jobs.slice(0, count).reduce((total, job) => total + job.pay, 0);
}
