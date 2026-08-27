import { AgentSolicitService } from "./agent-solicit-service.js";
import { SafetyService } from "./safety-service.js";
import { AuditService } from "./audit-service.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { TerminalGroupsService } from "./terminal-groups-service.js";
import { DelegationService } from "./delegation-service.js";

export interface FireDueResult {
  reminderId: number;
  sent: { agentName: string; target: string }[];
  skipped: { agentName: string; reason: string }[];
  auditIds: number[];
}

export class AgentReminderScheduler {
  constructor(
    private readonly solicitService: AgentSolicitService,
    private readonly tmuxService: TmuxService,
    private readonly safetyService: SafetyService,
    private readonly auditService: AuditService,
    private readonly groupsService: TerminalGroupsService,
    private readonly delegationService: DelegationService
  ) {}

  async fireDue(userId: number, folderGroup?: string): Promise<FireDueResult[]> {
    const due = this.solicitService.getDueReminders();
    const filtered = folderGroup ? due.filter(r => r.folder_group === folderGroup) : due;
    const results: FireDueResult[] = [];

    for (const reminder of filtered) {
      const result: FireDueResult = {
        reminderId: reminder.id,
        sent: [],
        skipped: [],
        auditIds: []
      };

      // Resolve current group panes
      const group = this.groupsService.get(userId);
      const groupMeta = group.groups.find(g => g.id === reminder.folder_group || g.name === reminder.folder_group);
      const sessionNames = groupMeta?.sessions ?? [];

      const includedRecipients = reminder.recipients.filter(r => r.include === 1);
      const panes = await this.tmuxService.listPanes();
      const solicitMessage = reminder.solicit_message || "give me a status update";

      // Safety check once per reminder
      const safety = this.safetyService.checkCommand(solicitMessage);
      if (safety.blocked) {
        // Skip all recipients if safety blocks
        for (const recipient of includedRecipients) {
          result.skipped.push({ agentName: recipient.agent_name, reason: "safety blocked" });
        }
      } else {
        for (const recipient of includedRecipients) {
          // Find tmux target for agent via session name
          const matching = panes.find(p => p.session === recipient.agent_name);
          if (!matching) {
            result.skipped.push({ agentName: recipient.agent_name, reason: "no pane" });
            continue;
          }

          const target = matching.target;

          // Send via Tmux
          const sendResult = await this.tmuxService.sendCommand(target, solicitMessage);
          if (sendResult.blocked) {
            result.skipped.push({ agentName: recipient.agent_name, reason: "safety blocked on send" });
            continue;
          }

          // Audit
          const auditId = this.auditService.log({
            userId,
            agentName: recipient.agent_name,
            actionType: "reminder_fire",
            resourceType: "agent_solicit_reminder",
            resourceId: String(reminder.id),
            details: { folder_group: reminder.folder_group, solicit_message: solicitMessage, target },
            tmuxTarget: target,
            surface: "miniapp"
          });
          result.auditIds.push(auditId);
          result.sent.push({ agentName: recipient.agent_name, target });
        }
      }

      // Advance / deactivate once per reminder
      this.solicitService.advanceReminder(reminder.id);

      // Skip excluded agents – they are not processed, no action needed
      results.push(result);
    }

    return results;
  }
}
