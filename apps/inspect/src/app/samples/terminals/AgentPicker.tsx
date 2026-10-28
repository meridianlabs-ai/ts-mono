import { FC } from "react";

import { ToolDropdownButton } from "@tsmono/react/components";

import type { TerminalAgent } from "./terminalModel";
import styles from "./Terminals.module.css";

interface AgentPickerProps {
  agents: TerminalAgent[];
  selected: TerminalAgent;
  onSelect: (agentId: string) => void;
}

/** The Terminals tab's agent menu (brief §9): the sample's agents indented by
 *  spawn depth, each with its terminal count. Render it only when there is
 *  more than one agent. */
export const AgentPicker: FC<AgentPickerProps> = ({
  agents,
  selected,
  onSelect,
}) => (
  <ToolDropdownButton
    label={
      <span className={styles.agentPickerLabel}>
        {selected.name}
        <span className={styles.agentCount}>· {terminalCount(selected)}</span>
      </span>
    }
    title="Show another agent's terminals"
    subtle
    dropdownAlign="right"
    dropdownClassName="text-size-smallest"
    heading="Agents in this sample"
    items={agents.map((agent) => ({
      key: agent.id,
      selected: agent.id === selected.id,
      onClick: () => onSelect(agent.id),
      label: (
        <span
          className={styles.agentItem}
          style={{ paddingLeft: `${agent.depth * 1.25}em` }}
        >
          {agent.depth > 0 ? (
            <span className={styles.agentSpawn} aria-hidden="true">
              ↳
            </span>
          ) : null}
          <span className={styles.agentName}>{agent.name}</span>
          <span className={styles.agentCount}>{agent.sessions.length}</span>
        </span>
      ),
    }))}
  />
);

const terminalCount = (agent: TerminalAgent): string =>
  `${agent.sessions.length} ${agent.sessions.length === 1 ? "term" : "terms"}`;
