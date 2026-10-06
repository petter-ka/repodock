import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", {
  variants: {
    variant: {
      default: "border-border bg-muted text-muted-foreground",
      outline: "border-border text-muted-foreground",
      success: "border-transparent bg-success/15 text-success",
      warning: "border-transparent bg-warning/15 text-warning",
      destructive: "border-transparent bg-destructive/15 text-destructive",
      info: "border-transparent bg-primary/15 text-primary",
    },
  },
  defaultVariants: { variant: "default" },
})

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
