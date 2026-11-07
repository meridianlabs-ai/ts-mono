import clsx from "clsx";
import { FC } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./ActivityBar.module.css";

interface Activity {
  id: string;
  label: string;
  icon: IconName;
  description?: string;
}

interface ActivityBarProps {
  activities: Activity[];
  onSelectActivity: (id: string, options?: { openInNewTab?: boolean }) => void;
  selectedActivity: string;
}

export const ActivityBar: FC<ActivityBarProps> = ({
  activities,
  selectedActivity,
  onSelectActivity,
}) => {
  return (
    <div className={clsx(styles.activityBar)}>
      <div className={clsx(styles.activityHost)}>
        {activities.map((activity) => (
          <Activity
            key={activity.id}
            id={activity.id}
            label={activity.label}
            icon={activity.icon}
            description={activity.description}
            selected={activity.id === selectedActivity}
            onSelect={onSelectActivity}
          />
        ))}
      </div>
    </div>
  );
};

interface ActivityProps extends Activity {
  selected?: boolean;
  onSelect: (id: string, options?: { openInNewTab?: boolean }) => void;
}

const Activity: FC<ActivityProps> = ({
  id,
  label,
  icon,
  description,
  selected,
  onSelect,
}) => {
  return (
    <button
      type="button"
      id={id}
      className={clsx(styles.activity, selected ? styles.selected : undefined)}
      title={description}
      aria-current={selected ? "page" : undefined}
      onClick={(e) => onSelect(id, { openInNewTab: e.metaKey || e.ctrlKey })}
    >
      <Icon name={icon} className={styles.icon} />
      <div className={clsx(styles.label)}>{label}</div>
    </button>
  );
};
