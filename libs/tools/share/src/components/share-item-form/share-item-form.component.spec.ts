import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ReactiveFormsModule } from "@angular/forms";
import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { SendDeletionDatePreset } from "@bitwarden/common/tools/models/send-deletion-date-preset";
import { WhoCanAccessType } from "@bitwarden/common/tools/models/send-who-can-access-type";
import { AuthType } from "@bitwarden/common/tools/send/types/auth-type";
import { CipherId, UserId } from "@bitwarden/common/types/guid";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { ToastService } from "@bitwarden/components";
import { newGuid } from "@bitwarden/guid";
import { LogService } from "@bitwarden/logging";
import { OrganizationId } from "@bitwarden/sdk-internal";
import { SendPolicyService } from "@bitwarden/send-ui";

import { ShareLink, ShareLinkService } from "../../services/share-link.service";

import { ShareItemFormComponent } from "./share-item-form.component";

const mockUserId = "user-123" as UserId;

const mockCipher = Object.assign(new CipherView(), {
  id: "cipher-123",
  name: "Test Login",
  type: CipherType.Login,
  login: { username: "user@example.com", uris: [] },
});

describe("ShareItemFormComponent", () => {
  let hostFixture: ComponentFixture<ShareItemFormComponent>;
  let component: ShareItemFormComponent;
  let platformUtilsService: MockProxy<PlatformUtilsService>;
  let toastService: MockProxy<ToastService>;
  let shareLinkService: MockProxy<ShareLinkService>;
  let i18nService: MockProxy<I18nService>;
  // Mock SendPolicyService observables
  let deletionDatePolicyInfo$: BehaviorSubject<{
    deletionHours: SendDeletionDatePreset | null;
    orgId: OrganizationId | null;
  } | null>;
  let allowedDomains$: BehaviorSubject<string[]>;
  let whoCanAccess$: BehaviorSubject<WhoCanAccessType | null>;
  let organizations$: BehaviorSubject<
    {
      id: OrganizationId;
      name: string;
    }[]
  >;

  beforeEach(async () => {
    platformUtilsService = mock<PlatformUtilsService>();
    toastService = mock<ToastService>();
    i18nService = mock<I18nService>();
    shareLinkService = mock<ShareLinkService>();

    i18nService.t.mockImplementation((key: string) => key);
    shareLinkService["links$"] = new BehaviorSubject<ShareLink[]>([]);

    const collectionService = mock<CollectionService>();
    collectionService.decryptedCollections$.mockReturnValue(of([]));

    const folderService = mock<FolderService>();
    folderService.folderViews$.mockReturnValue(of([]));

    deletionDatePolicyInfo$ = new BehaviorSubject<{
      deletionHours: SendDeletionDatePreset | null;
      orgId: OrganizationId | null;
    } | null>(null);
    allowedDomains$ = new BehaviorSubject<string[]>([]);
    whoCanAccess$ = new BehaviorSubject<WhoCanAccessType | null>(null);
    organizations$ = new BehaviorSubject<
      {
        id: OrganizationId;
        name: string;
      }[]
    >([]);

    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, ShareItemFormComponent],
      providers: [
        {
          provide: AccountService,
          useValue: {
            activeAccount$: of({
              id: mockUserId,
              ...mockAccountInfoWith({
                email: "test@email.com",
                name: "Test User",
              }),
            }),
          },
        },
        { provide: PlatformUtilsService, useValue: platformUtilsService },
        { provide: ToastService, useValue: toastService },
        { provide: I18nService, useValue: i18nService },
        { provide: ShareLinkService, useValue: shareLinkService },
        { provide: CollectionService, useValue: collectionService },
        { provide: FolderService, useValue: folderService },
        {
          provide: SendPolicyService,
          useValue: { deletionDatePolicyInfo$, allowedDomains$, whoCanAccess$ },
        },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: OrganizationService, useValue: { organizations$: () => organizations$ } },
      ],
    }).compileComponents();

    hostFixture = TestBed.createComponent(ShareItemFormComponent);
    component = hostFixture.componentInstance;
    hostFixture.componentRef.setInput("cipher", mockCipher);
    hostFixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should not create link when form is invalid", async () => {
    component.form.controls.emails.setValue("");
    await component.createAndCopyLink();
    expect(platformUtilsService.copyToClipboard).not.toHaveBeenCalled();
  });

  it("should create and copy link when form is valid", async () => {
    component.form.controls.emails.setValue("recipient@example.com");
    shareLinkService.createShareLink.mockResolvedValue("https://send.bitwarden.com/access-id/key");

    await component.createAndCopyLink();

    expect(platformUtilsService.copyToClipboard).toHaveBeenCalled();
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: "linkSavedAndCopied",
      }),
    );
  });

  it("should parse comma-delimited emails correctly", async () => {
    component.form.controls.emails.setValue("a@test.com, b@test.com, c@test.com");
    shareLinkService.createShareLink.mockResolvedValue("https://send.bitwarden.com/access-id/key");

    await component.createAndCopyLink();

    expect(shareLinkService.createShareLink).toHaveBeenCalledWith(mockCipher, {
      authType: AuthType.Email,
      emails: ["a@test.com", "b@test.com", "c@test.com"],
      password: undefined,
      expiryHours: 168,
      maxAccessCount: undefined,
    });
  });

  it("should copy link to clipboard", async () => {
    const mockLink = {
      cipherId: "cipher-123" as CipherId,
      sendId: "send-1",
      authType: AuthType.Email,
      emails: ["test@test.com"],
      expiresAt: new Date(),
      oneTimeShare: false,
      accessCount: 0,
      url: "https://vault.bitwarden.com/share/abc",
    };

    await component["copyLink"](mockLink);

    expect(platformUtilsService.copyToClipboard).toHaveBeenCalledWith(
      "https://vault.bitwarden.com/share/abc",
    );
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: "linkCopiedToClipboard",
      }),
    );
  });

  it("should delete a link and show toast", async () => {
    const mockLink = {
      cipherId: "cipher-123" as CipherId,
      sendId: "send-1",
      authType: AuthType.Email,
      emails: ["test@test.com"],
      expiresAt: new Date(),
      oneTimeShare: false,
      accessCount: 0,
      url: "https://vault.bitwarden.com/share/abc",
    };

    await component["deleteLink"](mockLink);

    expect(shareLinkService.deleteLink).toHaveBeenCalledWith("send-1");
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: "shareLinkDeleted",
      }),
    );
  });

  describe("who can view (hashpw)", () => {
    beforeEach(() => {
      shareLinkService.createShareLink.mockResolvedValue(
        "https://send.bitwarden.com/access-id/key",
      );
    });

    it("anyone with the link needs no emails and is one-time by default", async () => {
      component.form.controls.authType.setValue(AuthType.None);

      expect(component.form.valid).toBe(true);
      expect(component.form.controls.maxAccessCount.value).toBe(1);
      await component.createAndCopyLink();
      expect(shareLinkService.createShareLink).toHaveBeenCalledWith(mockCipher, {
        authType: AuthType.None,
        emails: [],
        password: undefined,
        expiryHours: 168,
        maxAccessCount: 1,
      });
    });

    it("a password link needs the password and hands it to the service", async () => {
      component.form.controls.emails.setValue("left@over.com");
      component.form.controls.authType.setValue(AuthType.Password);
      expect(component.form.invalid).toBe(true);

      component.form.controls.password.setValue("s3nha");
      await component.createAndCopyLink();
      expect(shareLinkService.createShareLink).toHaveBeenCalledWith(mockCipher, {
        authType: AuthType.Password,
        emails: [],
        password: "s3nha",
        expiryHours: 168,
        maxAccessCount: undefined,
      });
    });

    it("keeps the number of opens the user picked when the audience changes", () => {
      component.form.controls.maxAccessCount.setValue(3);
      component.form.controls.maxAccessCount.markAsDirty();
      component.form.controls.authType.setValue(AuthType.None);
      expect(component.form.controls.maxAccessCount.value).toBe(3);
    });

    it("goes back to no limit when an untouched open link turns email verified", () => {
      component.form.controls.authType.setValue(AuthType.None);
      component.form.controls.authType.setValue(AuthType.Email);
      expect(component.form.controls.maxAccessCount.value).toBe(0);
      expect(component.form.controls.emails.enabled).toBe(true);
      expect(component.form.controls.password.enabled).toBe(false);
    });

    it("offers only email verification when a policy asks for specific people", () => {
      component.form.controls.authType.setValue(AuthType.None);
      whoCanAccess$.next(WhoCanAccessType.SpecificPeople);

      expect(component["authTypeOptions"]().map((o) => o.value)).toEqual([AuthType.Email]);
      expect(component.form.controls.authType.value).toBe(AuthType.Email);
    });

    it("shows who can open each active link and how many opens are left", () => {
      const link = (authType: AuthType, maxAccessCount?: number): ShareLink => ({
        cipherId: "cipher-123" as CipherId,
        sendId: "send-1",
        authType,
        emails: authType === AuthType.Email ? ["a@test.com", "b@test.com"] : [],
        expiresAt: new Date(),
        oneTimeShare: maxAccessCount === 1,
        accessCount: 0,
        maxAccessCount,
        url: "https://vault.bitwarden.com/share/abc",
      });

      expect(component["linkAudience"](link(AuthType.None))).toBe("noAuth");
      expect(component["linkAudience"](link(AuthType.Password))).toBe("shareLinkWithPassword");
      expect(component["linkAudience"](link(AuthType.Email))).toBe("a@test.com, +1");
      expect(component["linkOpens"](link(AuthType.None))).toBe("");
      component["linkOpens"](link(AuthType.None, 1));
      expect(i18nService.t).toHaveBeenCalledWith("shareLinkOpens", "0", "1");
    });
  });

  it("should set the deletion date field to comply with any Send Controls policies", async () => {
    const orgId = newGuid() as unknown as OrganizationId;
    organizations$.next([{ name: "Test Org", id: orgId }]);
    deletionDatePolicyInfo$.next({ deletionHours: 72, orgId });
    hostFixture.detectChanges();
    const expiryHoursFormControl = component.form.get("expiryHours");
    expect(expiryHoursFormControl?.value).toEqual(72);
    expect(expiryHoursFormControl?.disabled).toEqual(true);
    deletionDatePolicyInfo$.next(null);
  });
});
