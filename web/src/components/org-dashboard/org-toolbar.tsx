"use client";

import { useMemo, useState } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";

import { getCampaignColorTone } from "@/lib/campaign-colors";

import { CampaignColorDot } from "./campaign-badge";
import type { ToolbarOption } from "./mock-data";
import { DashboardIcon } from "./org-icons";

type OrgToolbarProps = {
  accountOptions: ToolbarOption[];
  campaignOptions: ToolbarOption[];
  dateRangeOptions: Array<{
    id: string;
    label: string;
  }>;
  showAccountFilter?: boolean;
  showCampaignFilter?: boolean;
  showDateRangeFilter?: boolean;
  showActionButtons?: boolean;
  showUtilityButtons?: boolean;
};

type DropdownKey = "accounts" | "campaigns" | "date-range" | null;

const actionButtons = [
  { id: "refresh", label: "Refresh", icon: "refresh" as const },
  { id: "compare", label: "Compare", icon: "compare" as const },
  { id: "spotlight", label: "Spotlight", icon: "spotlight" as const },
  { id: "layout", label: "Saved layout", icon: "layout" as const },
];

function getSelectionLabel(
  options: ToolbarOption[],
  selectedIds: string[],
  fallbackLabel: string,
) {
  if (options.length === 0) {
    return `No ${fallbackLabel.toLowerCase()}`;
  }

  if (selectedIds.length === 0) {
    return fallbackLabel;
  }

  if (selectedIds.length === options.length) {
    return `All ${fallbackLabel.toLowerCase()}`;
  }

  if (selectedIds.length === 1) {
    return options.find((option) => option.id === selectedIds[0])?.label ?? fallbackLabel;
  }

  return `${selectedIds.length} selected`;
}

function getSelectedIds(
  searchParams: ReadonlyURLSearchParams,
  key: string,
  validIds: string[],
) {
  if (validIds.length === 0) {
    return [];
  }

  const rawValue = searchParams.get(key);

  if (!rawValue) {
    return [...validIds];
  }

  if (rawValue === "none") {
    return [];
  }

  const validIdSet = new Set(validIds);
  const selectedIds = rawValue
    .split(",")
    .map((entry: string) => entry.trim())
    .filter((entry: string) => validIdSet.has(entry));

  return selectedIds.length > 0 ? selectedIds : [...validIds];
}

export function OrgToolbar({
  accountOptions,
  campaignOptions,
  dateRangeOptions,
  showAccountFilter = true,
  showCampaignFilter = true,
  showDateRangeFilter = true,
  showActionButtons = true,
  showUtilityButtons = true,
}: OrgToolbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const [activeActions, setActiveActions] = useState<string[]>(["refresh"]);
  const accountIds = useMemo(
    () => accountOptions.map((option) => option.id),
    [accountOptions],
  );
  const campaignIds = useMemo(
    () => campaignOptions.map((option) => option.id),
    [campaignOptions],
  );
  const defaultDateRange = dateRangeOptions[1]?.id ?? dateRangeOptions[0]?.id ?? "";
  const selectedAccountIds = useMemo(
    () => getSelectedIds(searchParams, "accounts", accountIds),
    [accountIds, searchParams],
  );
  const selectedCampaignIds = useMemo(
    () => getSelectedIds(searchParams, "campaigns", campaignIds),
    [campaignIds, searchParams],
  );
  const selectedDateRange = dateRangeOptions.some(
    (option) => option.id === searchParams.get("range"),
  )
    ? (searchParams.get("range") ?? defaultDateRange)
    : defaultDateRange;

  function updateSearchParams(updater: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    updater(params);
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  function updateMultiSelectParam(
    key: string,
    validIds: string[],
    nextSelectedIds: string[],
  ) {
    updateSearchParams((params) => {
      params.delete("page");

      if (validIds.length === 0 || nextSelectedIds.length === validIds.length) {
        params.delete(key);
        return;
      }

      if (nextSelectedIds.length === 0) {
        params.set(key, "none");
        return;
      }

      params.set(key, nextSelectedIds.join(","));
    });
  }

  const selectedDateRangeLabel = useMemo(
    () =>
      dateRangeOptions.find((option) => option.id === selectedDateRange)?.label ??
      dateRangeOptions[1]?.label ??
      dateRangeOptions[0]?.label ??
      "Last 14 days",
    [dateRangeOptions, selectedDateRange],
  );

  return (
    <section className="rounded-[1.4rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-2.5 shadow-[0_18px_44px_rgba(0,0,0,0.18)] backdrop-blur sm:p-3">
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {showAccountFilter ? (
            <ToolbarDropdown
              emptyLabel="Accounts"
              isDisabled={accountOptions.length === 0}
              isOpen={openDropdown === "accounts"}
              label={getSelectionLabel(accountOptions, selectedAccountIds, "Accounts")}
              onToggle={() =>
                setOpenDropdown((value) => (value === "accounts" ? null : "accounts"))
              }
              options={accountOptions}
              onClear={() => updateMultiSelectParam("accounts", accountIds, [])}
              onSelectAll={() =>
                updateMultiSelectParam("accounts", accountIds, [...accountIds])
              }
              selectedIds={selectedAccountIds}
              onSelect={(id) => {
                const nextSelectedIds = selectedAccountIds.includes(id)
                  ? selectedAccountIds.filter((entry: string) => entry !== id)
                  : [...selectedAccountIds, id];

                updateMultiSelectParam("accounts", accountIds, nextSelectedIds);
              }}
            />
          ) : null}

          {showCampaignFilter ? (
            <ToolbarDropdown
              emptyLabel="Campaigns"
              isDisabled={campaignOptions.length === 0}
              isOpen={openDropdown === "campaigns"}
              label={getSelectionLabel(campaignOptions, selectedCampaignIds, "Campaigns")}
              onToggle={() =>
                setOpenDropdown((value) =>
                  value === "campaigns" ? null : "campaigns",
                )
              }
              options={campaignOptions}
              onClear={() => updateMultiSelectParam("campaigns", campaignIds, [])}
              onSelectAll={() =>
                updateMultiSelectParam("campaigns", campaignIds, [...campaignIds])
              }
              toneKind="campaign"
              selectedIds={selectedCampaignIds}
              onSelect={(id) => {
                const nextSelectedIds = selectedCampaignIds.includes(id)
                  ? selectedCampaignIds.filter((entry: string) => entry !== id)
                  : [...selectedCampaignIds, id];

                updateMultiSelectParam("campaigns", campaignIds, nextSelectedIds);
              }}
            />
          ) : null}

          {showActionButtons ? (
            <div className="flex flex-wrap items-center gap-2 xl:ml-2">
              {actionButtons.map((action) => {
                const isActive = activeActions.includes(action.id);

                return (
                  <button
                    key={action.id}
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-[0.9rem] border transition ${
                      isActive
                        ? "border-white/[0.14] bg-white/[0.09] text-foreground"
                        : "border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                    }`}
                    onClick={() =>
                      setActiveActions((current) =>
                        current.includes(action.id)
                          ? current.filter((entry) => entry !== action.id)
                          : [...current, action.id],
                      )
                    }
                    title={action.label}
                    type="button"
                  >
                    <DashboardIcon className="h-3.5 w-3.5" name={action.icon} />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showDateRangeFilter ? (
            <div className="relative">
              <button
                className="inline-flex min-h-10 items-center gap-2.5 rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[0.92rem] text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
                onClick={() =>
                  setOpenDropdown((value) =>
                    value === "date-range" ? null : "date-range",
                  )
                }
                type="button"
              >
                <DashboardIcon className="h-4 w-4 text-muted-foreground" name="calendar" />
                <span>{selectedDateRangeLabel}</span>
                <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-1.5 py-0.5 text-[0.56rem] uppercase tracking-[0.2em] text-muted-foreground">
                  UTC
                </span>
                <DashboardIcon className="h-4 w-4 text-muted-foreground" name="chevronDown" />
              </button>

              {openDropdown === "date-range" ? (
                <div className="absolute right-0 z-20 mt-2 min-w-[14rem] rounded-[1.05rem] border border-white/[0.08] bg-[#0c0c0f] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
                  {dateRangeOptions.map((option) => {
                    const isActive = option.id === selectedDateRange;

                    return (
                      <button
                        key={option.id}
                        className={`flex w-full items-center justify-between rounded-[0.85rem] px-3 py-2 text-left text-[0.92rem] transition ${
                          isActive
                            ? "bg-white/[0.08] text-foreground"
                            : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                        }`}
                        onClick={() => {
                          updateSearchParams((params) => {
                            params.delete("page");

                            if (option.id === defaultDateRange) {
                              params.delete("range");
                            } else {
                              params.set("range", option.id);
                            }
                          });
                          setOpenDropdown(null);
                        }}
                        type="button"
                      >
                        <span>{option.label}</span>
                        {isActive ? (
                          <DashboardIcon className="h-4 w-4 text-[#90FF4D]" name="check" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {showUtilityButtons ? (
            <>
              <button
                className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[0.92rem] text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                type="button"
              >
                UTC
              </button>

              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                type="button"
              >
                <DashboardIcon className="h-3.5 w-3.5" name="dotsHorizontal" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type ToolbarDropdownProps = {
  label: string;
  emptyLabel: string;
  options: ToolbarOption[];
  selectedIds: string[];
  isOpen: boolean;
  isDisabled: boolean;
  onToggle: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onSelect: (id: string) => void;
  toneKind?: "campaign";
};

function ToolbarDropdown({
  label,
  emptyLabel,
  options,
  selectedIds,
  isOpen,
  isDisabled,
  onToggle,
  onSelectAll,
  onClear,
  onSelect,
  toneKind,
}: ToolbarDropdownProps) {
  const selectedOption =
    toneKind === "campaign" && selectedIds.length === 1
      ? options.find((option) => option.id === selectedIds[0])
      : null;
  const selectedTone = selectedOption
    ? getCampaignColorTone(selectedOption.id)
    : null;

  return (
    <div className="relative">
      <button
        className={`inline-flex min-h-10 items-center gap-2.5 rounded-[0.95rem] border px-3.5 py-2 text-[0.92rem] transition ${
          isDisabled
            ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-muted-foreground/70"
            : "border-white/[0.08] bg-white/[0.04] text-foreground hover:border-white/[0.14] hover:bg-white/[0.07]"
        }`}
        disabled={isDisabled}
        onClick={onToggle}
        style={
          selectedTone && !isDisabled
            ? {
                background: selectedTone.background,
                borderColor: selectedTone.border,
              }
            : undefined
        }
        type="button"
      >
        {selectedOption ? (
          <CampaignColorDot
            campaignId={selectedOption.id}
            className="h-2 w-2"
            label={selectedOption.label}
          />
        ) : null}
        <span
          className={
            selectedIds.length === 0 || isDisabled ? "text-muted-foreground" : ""
          }
        >
          {isDisabled
            ? label
            : selectedIds.length === 0
              ? `Select ${emptyLabel.toLowerCase()}`
              : label}
        </span>
        <DashboardIcon className="h-4 w-4 text-muted-foreground" name="chevronDown" />
      </button>

      {isOpen ? (
        <div className="absolute left-0 z-20 mt-2 min-w-[16rem] rounded-[1.05rem] border border-white/[0.08] bg-[#0c0c0f] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          {options.length > 0 ? (
            <>
              <div className="mb-1.5 flex items-center justify-between gap-2 rounded-[0.85rem] border border-white/[0.06] bg-black/[0.18] px-3 py-2">
                <span className="text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
                  {selectedIds.length}/{options.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground transition hover:text-foreground"
                    onClick={onSelectAll}
                    type="button"
                  >
                    All
                  </button>
                  <button
                    className="text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground transition hover:text-foreground"
                    onClick={onClear}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {options.map((option) => {
                const isSelected = selectedIds.includes(option.id);
                const optionTone =
                  toneKind === "campaign" ? getCampaignColorTone(option.id) : null;

                return (
                  <button
                    key={option.id}
                    className={`flex w-full items-center justify-between gap-3 rounded-[0.85rem] border px-3 py-2 text-left text-[0.92rem] transition ${
                      isSelected
                        ? optionTone
                          ? "text-foreground"
                          : "border-transparent bg-white/[0.08] text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                    }`}
                    onClick={() => onSelect(option.id)}
                    style={
                      isSelected && optionTone
                        ? {
                            background: optionTone.background,
                            borderColor: optionTone.border,
                          }
                        : undefined
                    }
                    type="button"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      {optionTone ? (
                        <CampaignColorDot
                          campaignId={option.id}
                          label={option.label}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="truncate">{option.label}</p>
                        {option.meta ? (
                          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {option.meta}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {isSelected ? (
                      <DashboardIcon
                        className="h-4 w-4"
                        name="check"
                        style={optionTone ? { color: optionTone.dot } : undefined}
                      />
                    ) : null}
                  </button>
                );
              })}
            </>
          ) : (
            <div className="rounded-[0.85rem] border border-white/[0.06] bg-black/[0.18] px-3 py-4 text-[0.92rem] text-muted-foreground">
              No {emptyLabel.toLowerCase()} yet.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
