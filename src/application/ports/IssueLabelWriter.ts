export interface IssueLabelWriter {
  addLabel(issueKey: string, label: string): Promise<void>;
  clearSprintField(issueKey: string): Promise<void>;
}