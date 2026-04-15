import styles from './question-chip.module.css';

export interface QuestionChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  onClick?: React.MouseEventHandler;
  ref?: React.Ref<HTMLButtonElement>;
}

export function QuestionChip({
  text,
  onClick,
  ref,
  ...props
}: QuestionChipProps): React.ReactElement {
  return (
    <button className={styles.questionChip} ref={ref} onClick={onClick} {...props}>
      <div className={styles.questionChipContent}>{text}</div>
    </button>
  );
}
