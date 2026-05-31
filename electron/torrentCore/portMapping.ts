import { execFile } from "node:child_process";
import dgram from "node:dgram";
import os from "node:os";
import { promisify } from "node:util";
import type { SpeedDoctorPortMappingStatus } from "./contracts.js";

const execFileAsync = promisify(execFile);
const UPNP_SEARCH_TARGETS = [
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1"
];
const UPNP_SEARCH_HOST = "239.255.255.250";
const UPNP_SEARCH_PORT = 1900;
const MAPPING_LIFETIME_SECONDS = 3_600;
const REQUEST_TIMEOUT_MS = 2_500;

export interface PortMappingResult {
  upnpStatus: SpeedDoctorPortMappingStatus;
  natPmpStatus: SpeedDoctorPortMappingStatus;
  notes: string[];
}

interface UpnpGateway {
  location: string;
  controlUrl: string;
  serviceType: string;
}

export async function tryMapIncomingPort(port: number): Promise<PortMappingResult> {
  const notes: string[] = [];
  const [upnpStatus, natPmpStatus] = await Promise.all([
    tryMapUpnp(port, notes),
    tryMapNatPmp(port, notes)
  ]);

  return {
    upnpStatus,
    natPmpStatus,
    notes
  };
}

async function tryMapUpnp(
  port: number,
  notes: string[]
): Promise<SpeedDoctorPortMappingStatus> {
  let gateway: UpnpGateway | null = null;

  try {
    gateway = await discoverUpnpGateway();
  } catch (error) {
    notes.push(`UPnP discovery failed: ${getErrorMessage(error)}`);
    return "error";
  }

  if (!gateway) {
    notes.push("UPnP gateway was not discovered on the local network.");
    return "unavailable";
  }

  const results = await Promise.all([
    addUpnpMapping(gateway, port, "TCP"),
    addUpnpMapping(gateway, port, "UDP")
  ]);

  if (results.every(Boolean)) {
    notes.push("UPnP port mapping was created for TCP and UDP.");
    return "enabled";
  }

  notes.push("UPnP gateway answered, but at least one mapping request failed.");
  return "error";
}

async function discoverUpnpGateway(): Promise<UpnpGateway | null> {
  for (const target of UPNP_SEARCH_TARGETS) {
    const location = await ssdpSearch(target);

    if (!location) {
      continue;
    }

    const gateway = await loadUpnpGateway(location);

    if (gateway) {
      return gateway;
    }
  }

  return null;
}

function ssdpSearch(searchTarget: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const locations = new Set<string>();
    const request = [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${UPNP_SEARCH_HOST}:${UPNP_SEARCH_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      `ST: ${searchTarget}`,
      "",
      ""
    ].join("\r\n");
    const timeout = setTimeout(() => {
      socket.close();
      resolve([...locations][0] ?? null);
    }, REQUEST_TIMEOUT_MS);

    socket.on("message", (message) => {
      const location = parseSsdpLocation(message.toString("utf8"));

      if (location) {
        locations.add(location);
      }
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      socket.close();
      resolve(null);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(
        Buffer.from(request),
        UPNP_SEARCH_PORT,
        UPNP_SEARCH_HOST,
        (error) => {
          if (error) {
            clearTimeout(timeout);
            socket.close();
            resolve(null);
          }
        }
      );
    });
  });
}

function parseSsdpLocation(response: string) {
  const line = response
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().startsWith("location:"));
  return line?.slice(line.indexOf(":") + 1).trim() || null;
}

async function loadUpnpGateway(location: string): Promise<UpnpGateway | null> {
  const response = await fetch(location, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  const serviceMatch =
    matchService(xml, "urn:schemas-upnp-org:service:WANIPConnection:1") ??
    matchService(xml, "urn:schemas-upnp-org:service:WANPPPConnection:1");

  if (!serviceMatch) {
    return null;
  }

  return {
    location,
    serviceType: serviceMatch.serviceType,
    controlUrl: new URL(serviceMatch.controlUrl, location).toString()
  };
}

function matchService(xml: string, serviceType: string) {
  const escaped = serviceType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<service>[\\s\\S]*?<serviceType>\\s*${escaped}\\s*</serviceType>[\\s\\S]*?<controlURL>\\s*([^<]+)\\s*</controlURL>[\\s\\S]*?</service>`,
    "i"
  );
  const match = xml.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  return {
    serviceType,
    controlUrl: match[1].trim()
  };
}

async function addUpnpMapping(
  gateway: UpnpGateway,
  port: number,
  protocol: "TCP" | "UDP"
) {
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:AddPortMapping xmlns:u="${gateway.serviceType}">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${port}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
      <NewInternalPort>${port}</NewInternalPort>
      <NewInternalClient>${getLocalIPv4Address()}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>sTorent BitTorrent</NewPortMappingDescription>
      <NewLeaseDuration>${MAPPING_LIFETIME_SECONDS}</NewLeaseDuration>
    </u:AddPortMapping>
  </s:Body>
</s:Envelope>`;
  const response = await fetch(gateway.controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${gateway.serviceType}#AddPortMapping"`
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  return response.ok;
}

async function tryMapNatPmp(
  port: number,
  notes: string[]
): Promise<SpeedDoctorPortMappingStatus> {
  const gateway = await getDefaultGatewayAddress();

  if (!gateway) {
    notes.push("NAT-PMP gateway address could not be detected.");
    return "unavailable";
  }

  const results = await Promise.all([
    sendNatPmpMapRequest(gateway, port, "TCP"),
    sendNatPmpMapRequest(gateway, port, "UDP")
  ]);

  if (results.every(Boolean)) {
    notes.push("NAT-PMP port mapping was created for TCP and UDP.");
    return "enabled";
  }

  notes.push("NAT-PMP gateway did not accept at least one mapping request.");
  return "error";
}

function sendNatPmpMapRequest(
  gateway: string,
  port: number,
  protocol: "TCP" | "UDP"
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const request = Buffer.alloc(12);
    const opcode = protocol === "UDP" ? 1 : 2;
    const timeout = setTimeout(() => {
      socket.close();
      resolve(false);
    }, REQUEST_TIMEOUT_MS);

    request.writeUInt8(0, 0);
    request.writeUInt8(opcode, 1);
    request.writeUInt16BE(0, 2);
    request.writeUInt16BE(port, 4);
    request.writeUInt16BE(port, 6);
    request.writeUInt32BE(MAPPING_LIFETIME_SECONDS, 8);

    socket.on("message", (message) => {
      clearTimeout(timeout);
      socket.close();
      const responseOpcode = message.readUInt8(1);
      const resultCode = message.readUInt16BE(2);
      resolve(responseOpcode === opcode + 128 && resultCode === 0);
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      socket.close();
      resolve(false);
    });
    socket.send(request, 5351, gateway, (error) => {
      if (error) {
        clearTimeout(timeout);
        socket.close();
        resolve(false);
      }
    });
  });
}

async function getDefaultGatewayAddress() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("route", ["print", "-4", "0.0.0.0"], {
      timeout: REQUEST_TIMEOUT_MS
    });
    const routeLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^0\.0\.0\.0\s+0\.0\.0\.0\s+\d+\.\d+\.\d+\.\d+/.test(line));
    return routeLine?.split(/\s+/)[2] ?? null;
  }

  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("route", ["-n", "get", "default"], {
      timeout: REQUEST_TIMEOUT_MS
    });
    return stdout.match(/gateway:\s*(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
  }

  const { stdout } = await execFileAsync("ip", ["route", "show", "default"], {
    timeout: REQUEST_TIMEOUT_MS
  });
  return stdout.match(/default\s+via\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
}

function getLocalIPv4Address() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "127.0.0.1";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
