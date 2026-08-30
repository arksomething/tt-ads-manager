import {
  ArrowUpRight,
  Bell,
  CircleDollarSign,
  Flame,
  Home,
  PlaySquare,
} from "lucide-react";

const activity = [
  0, 1, 0, 2, 1, 0, 1, 2, 3, 1, 0, 2, 1, 1, 3, 2, 1, 0, 2, 3, 1, 2,
  0, 1, 2, 1, 3, 2, 2, 1, 0, 2, 3, 1, 2, 1, 3, 2, 1, 0, 1, 2, 3, 1,
];

export function LandingDashboard() {
  return (
    <div className="landing-dashboard" aria-label="Sample creator dashboard">
      <div className="landing-dashboard__rail" aria-hidden="true">
        <span className="mini-mark">G</span>
        <Home size={16} fill="currentColor" />
        <PlaySquare size={16} />
        <CircleDollarSign size={16} />
      </div>

      <div className="landing-dashboard__body">
        <div className="landing-dashboard__topline">
          <div>
            <span className="sample-label">Sample workspace</span>
            <h3>Dylan</h3>
          </div>
          <div className="landing-dashboard__streak">
            <Flame size={14} fill="currentColor" />
            12 days
          </div>
          <Bell aria-hidden="true" size={17} />
        </div>

        <div className="landing-dashboard__metrics">
          <div>
            <strong>2.4M</strong>
            <span>Views</span>
          </div>
          <div>
            <strong>$842</strong>
            <span>Est. earnings</span>
          </div>
          <div>
            <strong>2 / 3</strong>
            <span>Posts this week</span>
          </div>
        </div>

        <div className="mini-chart">
          <div className="mini-chart__header">
            <span>Views</span>
            <span>30 days</span>
          </div>
          <svg viewBox="0 0 660 150" role="img" aria-label="Sample thirty-day view trend">
            <path className="mini-chart__grid" d="M0 126H660M0 76H660M0 26H660" />
            <path
              className="mini-chart__line"
              d="M0 131 L35 123 L70 103 L105 91 L140 96 L175 75 L210 83 L245 55 L280 66 L315 36 L350 64 L385 57 L420 42 L455 59 L490 89 L525 68 L560 55 L595 73 L630 98 L660 82"
            />
            <circle cx="420" cy="42" r="5" />
          </svg>
        </div>

        <div className="mini-activity">
          <div className="mini-activity__label">
            <span>Activity</span>
            <span>12 day streak</span>
          </div>
          <div className="mini-activity__grid" aria-hidden="true">
            {activity.map((level, index) => (
              <span key={index} data-level={level} />
            ))}
          </div>
        </div>

        <div className="landing-dashboard__next">
          <div>
            <span>Next</span>
            <strong>Signs you&apos;re a late bloomer</strong>
          </div>
          <ArrowUpRight aria-hidden="true" size={18} />
        </div>
      </div>
    </div>
  );
}
