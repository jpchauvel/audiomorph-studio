import React from 'react';
import { cn } from '@/lib/utils';

export const MagicCard = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => {
  return (
    <div className={cn('relative overflow-hidden rounded-xl border', className)}>{children}</div>
  );
};
