import { execFileSync } from 'node:child_process';
import { signAsync } from '@electron/osx-sign';

// Select an exact local certificate when multiple certificates share a name.
export default async function signLocal(options) {
  const identity = process.env.TO3MATO_LOCAL_SIGN_IDENTITY;
  if (options.type !== 'development' || !/^[a-f0-9]{40}$/i.test(identity || ''))
    throw new Error('로컬 개발 서명 인증서의 SHA-1을 지정하세요.');
  const identities = execFileSync(
    'security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { encoding: 'utf8' },
  );
  if (!identities.toLowerCase().includes(identity.toLowerCase()))
    throw new Error('사용할 수 있는 로컬 서명 인증서가 아닙니다.');
  // codesign validates this exact certificate; skip only osx-sign's name lookup.
  await signAsync({ ...options, identity, identityValidation: false });
}
