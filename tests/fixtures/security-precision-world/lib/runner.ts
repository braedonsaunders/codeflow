import child_process from 'child_process';

export function run(userInput: string) {
  return child_process.exec(userInput);
}
