import { XMLParser } from 'fast-xml-parser';

const ENDPOINT = 'http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso';
const NAMESPACE = 'http://www.oorsprong.org/websamples.countryinfo';
const parser = new XMLParser({ removeNSPrefix: true, processEntities: false });

export class CountryNotFound extends Error {}
export class UpstreamError extends Error {}

function envelope(code) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FullCountryInfo xmlns="${NAMESPACE}"><sCountryISOCode>${code}</sCountryISOCode></FullCountryInfo>
  </soap:Body>
</soap:Envelope>`;
}

// `code` has already been validated as two letters, so it is safe to place in the XML.
export async function fetchCountry(code, fetchImpl = fetch) {
  let xml;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
      body: envelope(code),
      signal: AbortSignal.timeout(8000),
    });
    xml = await response.text();
  } catch (error) {
    throw new UpstreamError(`SOAP request failed: ${error.message}`);
  }

  let body;
  try {
    body = parser.parse(xml)?.Envelope?.Body;
  } catch {
    body = undefined;
  }
  if (!body) throw new UpstreamError('SOAP response was not a valid envelope');
  if (body.Fault) throw new UpstreamError(`SOAP fault: ${body.Fault.faultstring ?? 'unknown'}`);

  const result = body.FullCountryInfoResponse?.FullCountryInfoResult;
  if (!result) throw new UpstreamError('SOAP response had no country data');
  // An unknown code is a normal response with an empty ISO code, not a SOAP fault.
  if (!result.sISOCode) throw new CountryNotFound(result.sName);

  const languages = result.Languages?.tLanguage ?? [];
  return {
    code,
    name: result.sName,
    capital: result.sCapitalCity,
    continentCode: result.sContinentCode,
    currencyCode: result.sCurrencyISOCode,
    phoneCode: String(result.sPhoneCode),
    languages: [languages].flat().map((language) => language.sName),
  };
}
