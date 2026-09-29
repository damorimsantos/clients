import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  signal,
} from "@angular/core";
import { takeUntilDestroyed, toObservable } from "@angular/core/rxjs-interop";
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from "@angular/forms";
import { combineLatest, switchMap } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { SendDeletionDatePreset } from "@bitwarden/common/tools/models/send-deletion-date-preset";
import { WhoCanAccessType } from "@bitwarden/common/tools/models/send-who-can-access-type";
import { AuthType } from "@bitwarden/common/tools/send/types/auth-type";
import { CipherId } from "@bitwarden/common/types/guid";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { CipherViewLikeUtils } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import { filterOutNullish } from "@bitwarden/common/vault/utils/observable-utilities";
import {
  AccordionComponent,
  BitwardenIcon,
  ButtonModule,
  CheckboxModule,
  FormControlModule,
  FormFieldModule,
  IconButtonModule,
  IconModule,
  Option,
  SectionComponent,
  SelectModule,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
import { LogService } from "@bitwarden/logging";
import { SendPolicyService } from "@bitwarden/send-ui";
import { I18nPipe } from "@bitwarden/ui-common";

import { ShareLinkService } from "../../services/share-link.service";
import type { ShareLink } from "../../services/share-link.service";

@Component({
  selector: "app-share-item-form",
  templateUrl: "share-item-form.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AccordionComponent,
    ButtonModule,
    FormFieldModule,
    IconButtonModule,
    SectionComponent,
    SelectModule,
    CheckboxModule,
    FormControlModule,
    IconModule,
    TypographyModule,
    I18nPipe,
  ],
})
export class ShareItemFormComponent implements OnDestroy {
  private readonly accountService = inject(AccountService);
  private readonly collectionService = inject(CollectionService);
  private readonly folderService = inject(FolderService);
  private readonly i18nService = inject(I18nService);
  private readonly platformUtilsService = inject(PlatformUtilsService);
  private readonly toastService = inject(ToastService);
  private readonly shareLinkService = inject(ShareLinkService);
  private readonly sendPolicyService = inject(SendPolicyService);
  private readonly logService = inject(LogService);
  private readonly orgService = inject(OrganizationService);

  /** The cipher to share. Provided by the shell component. */
  readonly cipher = input.required<CipherView>();

  protected readonly activeLinks = signal<ShareLink[]>([]);
  protected readonly collections = signal<CollectionView[]>([]);
  protected readonly folder = signal<FolderView | undefined>(undefined);

  protected readonly cipherTypeIcon = computed<BitwardenIcon>(() => {
    const currentCipher = this.cipher();
    switch (currentCipher?.type) {
      case CipherType.Login:
        return "bwi-globe";
      case CipherType.Card:
        return "bwi-credit-card";
      case CipherType.Identity:
        return "bwi-id-card";
      case CipherType.SecureNote:
        return "bwi-sticky-note";
      case CipherType.SshKey:
        return "bwi-key";
      case CipherType.BankAccount:
        return "bwi-bank";
      case CipherType.DriversLicense:
        return "bwi-id-card";
      case CipherType.Passport:
        return "bwi-passport";
      default:
        return "bwi-globe";
    }
  });

  protected cipherSubtitle(): string | undefined {
    return CipherViewLikeUtils.subtitle(this.cipher(), this.i18nService);
  }

  protected readonly expiryOptions: Option<SendDeletionDatePreset>[] = [
    { label: this.i18nService.t("oneHour"), value: SendDeletionDatePreset.OneHour },
    { label: this.i18nService.t("oneDay"), value: SendDeletionDatePreset.OneDay },
    { label: this.i18nService.t("days", "2"), value: SendDeletionDatePreset.TwoDays },
    { label: this.i18nService.t("days", "3"), value: SendDeletionDatePreset.ThreeDays },
    { label: this.i18nService.t("days", "7"), value: SendDeletionDatePreset.SevenDays },
    { label: this.i18nService.t("days", "14"), value: SendDeletionDatePreset.FourteenDays },
    { label: this.i18nService.t("days", "30"), value: SendDeletionDatePreset.ThirtyDays },
  ];

  protected readonly AuthType = AuthType;

  /** hashpw: who can open the link. Upstream only has email verification for item links. */
  private readonly allAuthTypeOptions: Option<AuthType>[] = [
    { label: this.i18nService.t("specificPeople"), value: AuthType.Email },
    { label: this.i18nService.t("noAuth"), value: AuthType.None },
    { label: this.i18nService.t("anyOneWithPassword"), value: AuthType.Password },
  ];
  protected readonly authTypeOptions = signal<Option<AuthType>[]>(this.allAuthTypeOptions);

  /** hashpw: how many times the link opens; 0 is no limit until it expires */
  protected readonly maxAccessOptions: Option<number>[] = [
    { label: this.i18nService.t("shareOpensOnce"), value: 1 },
    ...[2, 3, 5, 10].map((n) => ({
      label: this.i18nService.t("shareOpensTimes", String(n)),
      value: n,
    })),
    { label: this.i18nService.t("shareOpensUnlimited"), value: 0 },
  ];

  private readonly emailListValidator: ValidatorFn = (
    control: AbstractControl,
  ): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }
    const emails = control.value.split(",").map((e: string) => e.trim());
    const nonEmptyEmails = emails.filter((e: string) => e.length > 0);
    if (nonEmptyEmails.length === 0) {
      return { required: true };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = nonEmptyEmails.filter((e: string) => !emailRegex.test(e));
    if (invalidEmails.length > 0) {
      return { multipleEmails: true };
    }

    const policyAllowedDomains = this.policyAllowedDomains();
    if (policyAllowedDomains && policyAllowedDomains.length > 0) {
      const disallowedEmails = nonEmptyEmails.filter((email: string) => {
        const domain = email.split("@")[1]?.toLowerCase();
        return !policyAllowedDomains.includes(domain);
      });
      if (disallowedEmails.length > 0) {
        return {
          domainNotAllowed: {
            value: control.value,
            domains: policyAllowedDomains.join(", "),
            message: this.i18nService.t("domainNotAllowed", policyAllowedDomains.join(", ")),
          },
        };
      }
    }

    return null;
  };

  private readonly emailsMaxLengthValidator: ValidatorFn = (
    control: AbstractControl,
  ): ValidationErrors | null => {
    if (typeof control.value !== "string" || control.value.length < 2500) {
      return null;
    }
    return {
      emailsMaxLength: {
        message: this.i18nService.t("sendEmailsCharacterLimitReached"),
      },
    };
  };

  readonly form = new FormGroup({
    authType: new FormControl<AuthType>(AuthType.Email, { nonNullable: true }),
    emails: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, this.emailListValidator, this.emailsMaxLengthValidator],
    }),
    password: new FormControl(
      { value: "", disabled: true },
      { nonNullable: true, validators: [Validators.required] },
    ),
    expiryHours: new FormControl<SendDeletionDatePreset>(SendDeletionDatePreset.SevenDays, {
      nonNullable: true,
    }),
    maxAccessCount: new FormControl<number>(0, { nonNullable: true }),
  });

  private readonly activeUserId$ = this.accountService.activeAccount$.pipe(getUserId);
  private readonly policyAllowedDomains = signal<string[] | undefined>(undefined);

  protected readonly policyDeletionHoursOrgName = signal<string | undefined>(undefined);

  constructor() {
    combineLatest([
      this.sendPolicyService.deletionDatePolicyInfo$,
      this.activeUserId$.pipe(switchMap((userId) => this.orgService.organizations$(userId))),
    ])
      .pipe(takeUntilDestroyed())
      .subscribe(([dh, organizations]) => {
        const expiryHoursFormControl = this.form.get("expiryHours");
        if (dh?.deletionHours) {
          expiryHoursFormControl?.setValue(dh.deletionHours);
          expiryHoursFormControl?.disable();
          const policyOrg = organizations.find((o) => o.id === dh.orgId);
          if (policyOrg) {
            this.policyDeletionHoursOrgName.set(policyOrg.name);
          }
        } else {
          expiryHoursFormControl?.enable();
          this.policyDeletionHoursOrgName.set(undefined);
        }
      });

    this.sendPolicyService.allowedDomains$
      .pipe(takeUntilDestroyed())
      .subscribe((allowedDomains) => {
        const emailsControl = this.form.get("emails");
        if (allowedDomains && allowedDomains.length > 0) {
          this.policyAllowedDomains.set(allowedDomains);
        } else {
          this.policyAllowedDomains.set(undefined);
        }
        emailsControl?.updateValueAndValidity();
      });

    this.form.controls.authType.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((authType) => this.applyAuthType(authType));

    // An organization that only allows specific people keeps the upstream form
    this.sendPolicyService.whoCanAccess$.pipe(takeUntilDestroyed()).subscribe((whoCanAccess) => {
      const onlyEmail = whoCanAccess === WhoCanAccessType.SpecificPeople;
      this.authTypeOptions.set(
        onlyEmail
          ? this.allAuthTypeOptions.filter((o) => o.value === AuthType.Email)
          : this.allAuthTypeOptions,
      );
      if (onlyEmail && this.form.controls.authType.value !== AuthType.Email) {
        this.form.controls.authType.setValue(AuthType.Email);
      }
    });

    const cipher$ = toObservable(this.cipher).pipe(filterOutNullish());

    combineLatest([
      cipher$,
      this.activeUserId$.pipe(
        switchMap((userId) => this.collectionService.decryptedCollections$(userId)),
      ),
    ])
      .pipe(takeUntilDestroyed())
      .subscribe(([cipher, allCollections]) => {
        this.collections.set(
          cipher.collectionIds?.length
            ? allCollections.filter((c) => cipher.collectionIds.includes(c.id))
            : [],
        );
      });

    combineLatest([
      cipher$,
      this.activeUserId$.pipe(switchMap((userId) => this.folderService.folderViews$(userId))),
    ])
      .pipe(takeUntilDestroyed())
      .subscribe(([cipher, allFolders]) => {
        this.folder.set(
          cipher.folderId
            ? (allFolders.find((f) => f.id === cipher.folderId) ?? undefined)
            : undefined,
        );
      });

    cipher$.pipe(takeUntilDestroyed()).subscribe((cipher) => {
      void this.shareLinkService.setCipher(cipher.id as CipherId);
    });

    this.shareLinkService.links$.pipe(takeUntilDestroyed()).subscribe((links) => {
      this.activeLinks.set(links);
    });
  }

  ngOnDestroy(): void {
    void this.shareLinkService.setCipher(undefined);
  }

  /** Only the field of the chosen auth type counts for validity */
  private applyAuthType(authType: AuthType): void {
    const { emails, password, maxAccessCount } = this.form.controls;
    if (authType === AuthType.Email) {
      emails.enable();
    } else {
      emails.disable();
    }
    if (authType === AuthType.Password) {
      password.enable();
    } else {
      password.disable();
    }
    // A link anyone can open is one-time unless the user already picked how many opens
    if (maxAccessCount.pristine) {
      maxAccessCount.setValue(authType === AuthType.None ? 1 : 0);
    }
  }

  protected copyPassword(): void {
    const password = this.form.controls.password.value;
    if (!password) {
      return;
    }
    this.platformUtilsService.copyToClipboard(password);
    this.toastService.showToast({
      variant: "success",
      title: undefined,
      message: this.i18nService.t("valueCopied", this.i18nService.t("password")),
    });
  }

  protected async copyLink(link: ShareLink): Promise<void> {
    this.platformUtilsService.copyToClipboard(link.url);
    this.toastService.showToast({
      variant: "success",
      title: undefined,
      message: this.i18nService.t("linkCopiedToClipboard"),
    });
  }

  protected async deleteLink(link: ShareLink): Promise<void> {
    try {
      await this.shareLinkService.deleteLink(link.sendId);
      this.toastService.showToast({
        variant: "success",
        title: undefined,
        message: this.i18nService.t("shareLinkDeleted"),
      });
    } catch (err) {
      this.logService.error(err);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("shareLinkDeleteFailed"),
      });
    }
  }

  async createAndCopyLink(): Promise<boolean> {
    if (this.form.invalid) {
      return false;
    }

    const currentCipher = this.cipher();
    if (!currentCipher) {
      return false;
    }

    const formValue = this.form.getRawValue();
    const authType = formValue.authType;
    const emails =
      authType === AuthType.Email
        ? formValue.emails
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e.length > 0)
        : [];

    try {
      const link = await this.shareLinkService.createShareLink(currentCipher, {
        authType,
        emails,
        password: authType === AuthType.Password ? formValue.password : undefined,
        expiryHours: formValue.expiryHours,
        maxAccessCount: formValue.maxAccessCount > 0 ? formValue.maxAccessCount : undefined,
      });

      if (link) {
        this.platformUtilsService.copyToClipboard(link);
        this.toastService.showToast({
          variant: "success",
          message: this.i18nService.t("linkSavedAndCopied"),
        });
        this.form.controls.emails.reset();
        return true;
      } else {
        this.toastService.showToast({
          variant: "error",
          message: this.i18nService.t("linkSavedCopyFailed"),
        });
        return false;
      }
    } catch (err) {
      this.logService.error(err);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("linkSaveFailed"),
      });
      return false;
    }
  }

  protected linkEmailDisplay(emails: string[]): string {
    if (emails.length <= 1) {
      return emails[0] ?? "";
    }
    return `${emails[0]}, +${emails.length - 1}`;
  }

  /** Who can open an active link: its emails, or who else the auth type lets in */
  protected linkAudience(link: ShareLink): string {
    if (link.authType === AuthType.None) {
      return this.i18nService.t("noAuth");
    }
    if (link.authType === AuthType.Password) {
      return this.i18nService.t("shareLinkWithPassword");
    }
    return this.linkEmailDisplay(link.emails);
  }

  protected linkOpens(link: ShareLink): string {
    if (!link.maxAccessCount) {
      return "";
    }
    return this.i18nService.t(
      "shareLinkOpens",
      String(link.accessCount),
      String(link.maxAccessCount),
    );
  }
}
