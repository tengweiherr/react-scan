'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function Monitoring() {
  return (
    <div className="max-w-xl mx-auto">
      <div className="space-y-4 mt-8">
        <div>
          <span className="font-bold">React Scan Monitoring</span> helps detect
          React components that cause the most lag for your users
        </div>

        <p>It takes less than 2 minutes to set up.</p>

        <Link
          className="inline-block px-5 py-2 font-medium text-white bg-black text-center whitespace-nowrap disabled:opacity-50"
          href="https://dashboard.react-scan.com/"
        >
          Try it out!
        </Link>

        <div className="relative h-[400px] my-8">
          <Image
            src="/after.png"
            alt="React Scan Monitoring"
            fill
            className="object-contain"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Link
              href="https://dashboard.react-scan.com/project/demo"
              className="bg-white px-6 py-2 text-black font-medium shadow-xl hover:bg-gray-100 transition-colors"
            >
              View demo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
